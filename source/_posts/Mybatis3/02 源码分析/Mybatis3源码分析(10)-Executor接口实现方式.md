---
title: Mybatis3源码分析之Executor接口实现方式
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: implementation-of-executor-interface-for-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:50:47
show_title: mybatis3-executor
---

之前介绍过，Executor接口定义了对象操作库操作的基本方法：select/update/insert/delete/commit/rollbak/close。Mybatis对Executor接口的实现主要采用了模板模式和装饰模式两种设计模式。

Executor类关系
===========

![](https://img-blog.csdn.net/20151220223216683)  

其中CloseExecutor为一个类的内部了，而且是private的，先不讨论！

![](https://img-blog.csdn.net/20151220224146815)  

1.  BaseExecutor为模板模式中的模板类。这个类在Executor接口实现中非常重要，其实现了Executor的大部分方法。他的子类只要实现三个方法即可，其中两个是doUpdate和doSelect方法，子类在实现这两个方法时直接操作数据库即可，其余的工作交由BaseExecutor完成。
2.  CachingExecutor是一个Executor的装饰器，给一个Executor增加了缓存的功能。

模板模式和装饰模式前面分析加载Configuration中也用到，说明这个设计模式的重要性，这两种设计模式也在Spring中很多地方采用。作为java程序员应该详细解读并应用这两种设计模式！

Executor接口主要方法
==============

    public interface Executor {
       //执行update/insert/delete
      int update(MappedStatement ms, Object parameter) throws SQLException;
      //执行查询
      <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey cacheKey, BoundSql boundSql) throws SQLException;
      //执行查询
      <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler) throws SQLException;
      //以后有机会在分析 
      List<BatchResult> flushStatements() throws SQLException;
      //事务提交
      void commit(boolean required) throws SQLException;
      //事务回滚
      void rollback(boolean required) throws SQLException;
      //生成缓存的key
      CacheKey createCacheKey(MappedStatement ms, Object parameterObject, RowBounds rowBounds, BoundSql boundSql);
      
      boolean isCached(MappedStatement ms, CacheKey key);
    
      void clearLocalCache();
    
      void deferLoad(MappedStatement ms, MetaObject resultObject, String property, CacheKey key, Class<?> targetType);
    
      Transaction getTransaction();
    
      void close(boolean forceRollback);
    
      boolean isClosed();
      
      void setExecutorWrapper(Executor executor);
    
    }

BaseExecutor
============

再来看看BaseExcutor模板是怎么实现Executor的

BaseExecutor有两个主要的属性:事务及本地缓存

    protected BaseExecutor(Configuration configuration, Transaction transaction) {
        //transaction，实现commit/rollback/close
        this.transaction = transaction;
        this.deferredLoads = new ConcurrentLinkedQueue<DeferredLoad>();
        //本地缓存，也就是一级缓存
        this.localCache = new PerpetualCache("LocalCache");
        this.localOutputParameterCache = new PerpetualCache("LocalOutputParameterCache");
        this.closed = false;
        this.configuration = configuration;
        this.wrapper = this;
      }

再来看看BaseExecutor是怎么实现查询和更新的

    public int update(MappedStatement ms, Object parameter) throws SQLException {
        ErrorContext.instance().resource(ms.getResource()).activity("executing an update").object(ms.getId());
        if (closed) throw new ExecutorException("Executor was closed.");
        clearLocalCache();
        //调用了doUpdate方法完成更新，这个方法是抽象的，由子类实现
        return doUpdate(ms, parameter);
      }

     protected abstract int doUpdate(MappedStatement ms, Object parameter)
          throws SQLException;
    

  

       //查询
      private <E> List<E> queryFromDatabase(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey key, BoundSql boundSql) throws SQLException {
        List<E> list;
        localCache.putObject(key, EXECUTION_PLACEHOLDER);
        try {
         //调用doQuery方法，这个方法也是抽象的
          list = doQuery(ms, parameter, rowBounds, resultHandler, boundSql);
        } finally {
          localCache.removeObject(key);
        }
        localCache.putObject(key, list);
        if (ms.getStatementType() == StatementType.CALLABLE) {
          localOutputParameterCache.putObject(key, parameter);
        }
        return list;
      }

    protected abstract <E> List<E> doQuery(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql)
          throws SQLException;

  

CachingExecutor实现缓存
===================

     public CachingExecutor(Executor delegate) {
        //操作数据库的动作都是由这个Executor来完成的。
        this.delegate = delegate;
        delegate.setExecutorWrapper(this);
      }

对于Mybatis的缓存以后再详细分析。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
