---
title: Mybatis3源码分析之缓存的实现
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: implementation-of-mybatis3-source-code-analysis-cache
special: m3s
original: false
reproduced: true
date: 2021-05-11 15:30:47
show_title: mybatis3-cache-implementation
---

Mybatis主要有两种缓存：一级缓存和二级缓存。

一级缓存的生命周期与SqlSession的生命周期一样。一级缓存是在BaseExecutor中实现。

二级缓存的生命周期跟SqlSessionFactory一样，通常在整个应用中有效。二级缓存是通过CachingExecutor来实现的。

一级缓存
====

Mybatis提供了如下方式来配置一级缓存:

    <setting name="localCacheScope" value="SESSION|STATEMENT"/>

  
SESSION表示在整个SqlSession中有效。

STATEMENT表示在STATEMENT中有效？暂时理解为不使用一级缓存。

  

在BaseExecutor中会有一个localCache对象，就是来保存缓存数据的。

     protected BaseExecutor(Configuration configuration, Transaction transaction) {
        this.transaction = transaction;
        this.deferredLoads = new ConcurrentLinkedQueue<DeferredLoad>();
        //创建一个缓存对象，PerpetualCache并不是线程安全的，但SqlSession和Executor对象在通常情况下只能有一个线程访问，而且访问完成之后马上销毁。
        this.localCache = new PerpetualCache("LocalCache");
    
        //这是执行过程中的缓存，这里不做分析。
        this.localOutputParameterCache = new PerpetualCache("LocalOutputParameterCache");
        this.closed = false;
        this.configuration = configuration;
        this.wrapper = this;
      }

再来看BaseExecutor中的query方法是怎么实现一级缓存的

    public <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler) throws SQLException {
        BoundSql boundSql = ms.getBoundSql(parameter);
        //利用sql和执行的参数生成一个key，如果同一sql不同的执行参数的话，将会生成不同的key
        CacheKey key = createCacheKey(ms, parameter, rowBounds, boundSql);
        return query(ms, parameter, rowBounds, resultHandler, key, boundSql);
     }
    
      @SuppressWarnings("unchecked")
      public <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey key, BoundSql boundSql) throws SQLException {
        ErrorContext.instance().resource(ms.getResource()).activity("executing a query").object(ms.getId());
        if (closed) throw new ExecutorException("Executor was closed.");
        if (queryStack == 0 && ms.isFlushCacheRequired()) {
          clearLocalCache();
        }
        List<E> list;
        try {
          queryStack++;
          //从缓存中取出数据
          list = resultHandler == null ? (List<E>) localCache.getObject(key) : null;
          if (list != null) {
            //如果缓存中有数据，处理过程的缓存
            handleLocallyCachedOutputParameters(ms, key, parameter, boundSql);
          } else {
           //如果缓存中没有数据，将sql执行生成结果，并加入localCache中。
            list = queryFromDatabase(ms, parameter, rowBounds, resultHandler, key, boundSql);
          }
        } finally {
          queryStack--;
        }
        if (queryStack == 0) {
          for (DeferredLoad deferredLoad : deferredLoads) {
            deferredLoad.load();
          }
          deferredLoads.clear(); // issue #601
          if (configuration.getLocalCacheScope() == LocalCacheScope.STATEMENT) {
            //如果配置为STATEMENT时，将清除所有缓存。说明STATEMENT类型的查询只有queryFromDatabase方法中有效。
            clearLocalCache(); // issue #482
          }
        }
        return list;
      }

    private <E> List<E> queryFromDatabase(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey key, BoundSql boundSql) throws SQLException {
        List<E> list;
        localCache.putObject(key, EXECUTION_PLACEHOLDER);
        try {
          //执行sql生成数据
          list = doQuery(ms, parameter, rowBounds, resultHandler, boundSql);
        } finally {
          localCache.removeObject(key);
        }
        //将缓存加入到localCache中
        localCache.putObject(key, list);
        if (ms.getStatementType() == StatementType.CALLABLE) {
          localOutputParameterCache.putObject(key, parameter);
        }
        return list;
      }

如果执行了update方法，localCache也会被清除：

    public int update(MappedStatement ms, Object parameter) throws SQLException {
        ErrorContext.instance().resource(ms.getResource()).activity("executing an update").object(ms.getId());
        if (closed) throw new ExecutorException("Executor was closed.");
        //每次执行update/insert/delete语句时都会清除一级缓存。
        clearLocalCache();
        return doUpdate(ms, parameter);
      }

以上代码可以看出一级缓存中的基本策略。

1.  一级缓存只在同一个SqlSession中共享数据
2.  在同一个SqlSession对象执行相同的sql并参数也要相同，缓存才有效。
3.  如果在SqlSession中执行update/insert/detete语句的话，SqlSession中的executor对象会将一级缓存清空。

二级缓存
====

二级缓存对所有的SqlSession对象都有效。需要注意如下几点：

1.  二级缓存是跟一个命名空间绑定的。
2.  在一个SqlSession中可以执行多个不同命名空间中的sql,也是就说一个SqlSession需要对多个Cache进行操作。
3.  调用SqlSession.commit()之后，缓存才会被加入到相应的Cache。

下面来看CachingExecutor是怎么实现的。

    private TransactionalCacheManager tcm = new TransactionalCacheManager();

这个manager实现了对多个Cache的管理，SqlSession.commit()之后，数据加入到相应的Cache也是由这个对象来实现的。

如下是CachingExecutor的commit()和rollback()方法

    public void commit(boolean required) throws SQLException {
        //提交数据库的事务
        delegate.commit(required);
        //将数据刷新到Cache中，使数据对其他的SqlSession也可见
        tcm.commit();
      }
    
      public void rollback(boolean required) throws SQLException {
        try {
          delegate.rollback(required);
        } finally {
          if (required) {
            //清除临时的数据，不将数据刷新到Cache中
            tcm.rollback();
          }
        }
      }
    

  
如下是TransactionCacheManager的源代码

    public class TransactionalCacheManager {
    
      //管理了多个Cache，每个Cache对应一个TransactionalCache
      private Map<Cache, TransactionalCache> transactionalCaches = new HashMap<Cache, TransactionalCache>();
    
      //清空未commit()的临时数据
      public void clear(Cache cache) {
        getTransactionalCache(cache).clear();
      }
    
      //获取缓存数据
      public Object getObject(Cache cache, CacheKey key) {
        return getTransactionalCache(cache).getObject(key);
      }
      
      //设置缓存数据，数据应该被保存在临时区域，只commit才会保存在cache中
      public void putObject(Cache cache, CacheKey key, Object value) {
        getTransactionalCache(cache).putObject(key, value);
      }
    
      //数据临时数据刷新的Cache中，使用数据对其他的SqlSession对象也可见
      public void commit() {
        for (TransactionalCache txCache : transactionalCaches.values()) {
          txCache.commit();
        }
      }
      
      //回滚，应该是清除临时区域的数据
      public void rollback() {
        for (TransactionalCache txCache : transactionalCaches.values()) {
          txCache.rollback();
        }
      }
      
      //获取对应的TransactionalCache,没有就生成一个
      private TransactionalCache getTransactionalCache(Cache cache) {
        TransactionalCache txCache = transactionalCaches.get(cache);
        if (txCache == null) {
          txCache = new TransactionalCache(cache);
          transactionalCaches.put(cache, txCache);
        }
        return txCache;
      }
    
    }

  
再看看TransactionCache对象是怎么管理数据缓存数据的

    public class TransactionalCache implements Cache {
    
      private Cache delegate;
      //这个对象如果被设置为true，commit时Cache会先清除所有的数据
      private boolean clearOnCommit;
    
      //临时区域，提交时需要将数据刷新对Cache
      private Map<Object, AddEntry> entriesToAddOnCommit;
      
      //临时区域，提交时需要将数据从Cache中删除
      private Map<Object, RemoveEntry> entriesToRemoveOnCommit;
    
      public TransactionalCache(Cache delegate) {
        this.delegate = delegate;
        this.clearOnCommit = false;
        this.entriesToAddOnCommit = new HashMap<Object, AddEntry>();
        this.entriesToRemoveOnCommit = new HashMap<Object, RemoveEntry>();
      }
    
      @Override
      public String getId() {
        return delegate.getId();
      }
    
      @Override
      public int getSize() {
        return delegate.getSize();
      }
    
      @Override
      public Object getObject(Object key) {
        if (clearOnCommit) return null; // issue #146
        return delegate.getObject(key);
      }
    
      @Override
      public ReadWriteLock getReadWriteLock() {
        return null;
      }
    
      @Override
      public void putObject(Object key, Object object) {
        entriesToRemoveOnCommit.remove(key);
    
        //将数据放到临时区域，提交时再刷新到cache中
        entriesToAddOnCommit.put(key, new AddEntry(delegate, key, object));
      }
    
      @Override
      public Object removeObject(Object key) {
        entriesToAddOnCommit.remove(key);
        
        //将数据放到临时区域，提交时再从cache删除
        entriesToRemoveOnCommit.put(key, new RemoveEntry(delegate, key));
        return delegate.getObject(key);
      }
    
      @Override
      public void clear() {
        reset();
        clearOnCommit = true;
      }
    
      public void commit() {
        if (clearOnCommit) {
          //先清除所有的数据
          delegate.clear();
        } else {
          for (RemoveEntry entry : entriesToRemoveOnCommit.values()) {
            //从cache中删除数据
            entry.commit();
          }
        }
        for (AddEntry entry : entriesToAddOnCommit.values()) {
          //将数据刷新到cache
          entry.commit();
        }
        reset();
      }
    
      public void rollback() {
        reset();
      }
      
      //清空临时区域
      private void reset() {
        clearOnCommit = false;
        entriesToRemoveOnCommit.clear();
        entriesToAddOnCommit.clear();
      }
    
      private static class AddEntry {
        private Cache cache;
        private Object key;
        private Object value;
    
        public AddEntry(Cache cache, Object key, Object value) {
          this.cache = cache;
          this.key = key;
          this.value = value;
        }
    
        public void commit() {
          //加数据
          cache.putObject(key, value);
        }
      }
    
      private static class RemoveEntry {
        private Cache cache;
        private Object key;
    
        public RemoveEntry(Cache cache, Object key) {
          this.cache = cache;
          this.key = key;
        }
    
        public void commit() {
          //删除数据
          cache.removeObject(key);
        }
      }
    
    }

总结以上代码重要的几点

1.  TransactionCache.put()方法是先将数据保存在临时的数据区域,并未在Cache加入数据  
    
2.  TransactionCache.remove()方法是先在一个临时区域中保存要删除的数据，并未在Cache中删除数据  
    
3.  TransactionCache.commit()方法将保存在临时区域的数据真正加入Cache中，将临时区域中需要删除的数据真正删除  
    
4.  TransactionCache.rollback()方法，只是清除了临时区域中的数据  
    
5.  TransactionCache.clear()方法，告诉commit()方法，先清除缓存的数据，再执行后续操作。但clear方法本身不会清除缓存中的数据  
    

下面来看CachingExecutor是怎么利用这几个方法实现缓存的

    <p style="margin-top: 0px; margin-bottom: 0px; font-family: Monaco;"></p><pre name="code" class="java">public <E> List<E> query(MappedStatement ms, Object parameterObject, RowBounds rowBounds, ResultHandler resultHandler) throws SQLException {
        BoundSql boundSql = ms.getBoundSql(parameterObject);
        //生成一个key
        CacheKey key = createCacheKey(ms, parameterObject, rowBounds, boundSql);
        return query(ms, parameterObject, rowBounds, resultHandler, key, boundSql);
      }
      public <E> List<E> query(MappedStatement ms, Object parameterObject, RowBounds rowBounds, ResultHandler resultHandler, CacheKey key, BoundSql boundSql)
          throws SQLException {
        //从MappedStatement获取一个Cache，如果对象的命名空间没有配置cache或cache-ref节点,cache将为空，表示不使用缓存
        Cache cache = ms.getCache();
        if (cache != null) {
          //如果需要刷新缓存的话就刷新：flushCache="true"
          flushCacheIfRequired(ms);
          if (ms.isUseCache() && resultHandler == null) {
            //userCache="true"
            ensureNoOutParams(ms, parameterObject, boundSql);
            @SuppressWarnings("unchecked")
            //从Cache获取数据
            List<E> list = (List<E>) tcm.getObject(cache, key);
            if (list == null) {
              //如果缓存中没有，就执行SQL生成数据
              list = delegate.<E> query(ms, parameterObject, rowBounds, resultHandler, key, boundSql);
              
              //将数据加入到临时区域
              tcm.putObject(cache, key, list); // issue #578. Query must be not synchronized to prevent deadlocks
            }
            return list;
          }
        }
        return delegate.<E> query(ms, parameterObject, rowBounds, resultHandler, key, boundSql);
      }

    public int update(MappedStatement ms, Object parameterObject) throws SQLException {
        //如果需要刷新缓存的话就刷新：flushCache="true"
        flushCacheIfRequired(ms);
        return delegate.update(ms, parameterObject);
      }

    private void flushCacheIfRequired(MappedStatement ms) {
        Cache cache = ms.getCache();
        if (cache != null && ms.isFlushCacheRequired()) {  
          //commit()方法之后会清除所有的缓存    
          tcm.clear(cache);
        }
      }

小结
==

1.  一级缓存只在一个SqlSession中有效，执行update/insert/delete语句后，一级缓存将会被清除。
2.  二级缓存对所有的SqlSession有效，执行flushCache="true"的语句后，二级缓存将会被清除。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
