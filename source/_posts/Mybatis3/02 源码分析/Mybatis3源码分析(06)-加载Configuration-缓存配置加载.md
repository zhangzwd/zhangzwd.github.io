---
title: Mybatis3源码分析之缓存配置加载
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-analysis-of-the-cache-configuration-load
special: m3s
original: false
reproduced: true
show_title: mybatis3-configuration-load
date: 2021-05-11 13:30:47
---
Mybatis中的mapper配置文件中，除了经常配置select/update/insert/delete/resultMap节点之外，我们可能还会为Mybatis配置一个或几个缓存。接下来分析一下Mybatis是怎么将mapper配置文件中的缓存配置加载到Configuration对象中的。

Mybatis中的缓存类型
=============

Mybatis支持两种缓存

1.  一级缓存，也叫本地缓存。这个缓存是在sqlSession中的实现的,sqlSession关闭之后这个缓存也将不存在，默认是开启的，当然了也可以在Mybatis-config配置文件中关闭。对于这个缓存策略后面会析到。
2.  二级缓存。这个缓存是在命名空间有效，可以被多个sqlSession共享。开启这个缓存是在mapper.xml中配置的，这里主要是讨论缓存的配置怎么样加载到Configuration中。缓存的具体实现以后再讨论。

本章节下面的文档如出现"缓存"，如果没有特别说明，指的就是二级缓存。

  

缓存的配置方式
=======

这里有非常详细的说明:[http://mybatis.org/mybatis-3/zh/sqlmap-xml.html#cache](http://mybatis.org/mybatis-3/zh/sqlmap-xml.html#cache)

主要有两种方式配置

1.      <cache
          eviction="FIFO"
          flushInterval="60000"
          size="512"
          readOnly="true"/>
    
    为当前的命名空间配置缓存
2.      <cache-ref namespace="com.someone.application.data.SomeMapper"/>
    
    引用其他命名空间中的缓存

cache节点缓存配置读取
=============

    private void cacheElement(XNode context) throws Exception {
        if (context != null) {
          //读取想着属性
    
          //缓存类型，默认为PERPETUAL,为永久的，当回收策略会再包装一下，变化可回收的啦
          String type = context.getStringAttribute("type", "PERPETUAL");
          Class<? extends Cache> typeClass = typeAliasRegistry.resolveAlias(type);
          
          //回收策略，LRU,最少使用的被回收
          String eviction = context.getStringAttribute("eviction", "LRU");
          Class<? extends Cache> evictionClass = typeAliasRegistry.resolveAlias(eviction);
          Long flushInterval = context.getLongAttribute("flushInterval");
          Integer size = context.getIntAttribute("size");
          boolean readWrite = !context.getBooleanAttribute("readOnly", false);
          Properties props = context.getChildrenAsProperties();
    
          //构建一个Cache对象，并加入Configuration
          builderAssistant.useNewCache(typeClass, evictionClass, flushInterval, size, readWrite, props);
        }
      }

    public Cache useNewCache(Class<? extends Cache> typeClass,
          Class<? extends Cache> evictionClass,
          Long flushInterval,
          Integer size,
          boolean readWrite,
          Properties props) {
        typeClass = valueOrDefault(typeClass, PerpetualCache.class);
        evictionClass = valueOrDefault(evictionClass, LruCache.class);
        //交由Builder处理,命名空间作为cache的id
        Cache cache = new CacheBuilder(currentNamespace)
            .implementation(typeClass)
            .addDecorator(evictionClass)//这里的evictionClass也是一个Cache,设计模型中的装饰模式
            .clearInterval(flushInterval)
            .size(size)
            .readWrite(readWrite)
            .properties(props)
            .build();
        //将cache加入configuration中
        configuration.addCache(cache);
        //设置当前命名空间的缓存，在之后的解析select/update/insert/delete节点设置缓存里使用currentCache
        currentCache = cache;
        return cache;
      }

    public Cache build() {
        setDefaultImplementations();
        //生成基本的Cache实现
        Cache cache = newBaseCacheInstance(implementation, id);
        setCacheProperties(cache);
        if (PerpetualCache.class.equals(cache.getClass())) { // issue #352, do not apply decorators to custom caches
          for (Class<? extends Cache> decorator : decorators) {
            //使策略生效
            cache = newCacheDecoratorInstance(decorator, cache);
            setCacheProperties(cache);
          }
          //为cache加上一些指定的额外的服务，如、日志及线程安全
          cache = setStandardDecorators(cache);
        }
        return cache;
      }

PerpetualCache实现

这个类就是利用HashMap实现的。

    public class PerpetualCache implements Cache {
    
      private String id;
    
      private Map<Object, Object> cache = new HashMap<Object, Object>();
    
      public PerpetualCache(String id) {
        this.id = id;
      }
    
      public String getId() {
        return id;
      }
    
      public int getSize() {
        return cache.size();
      }
    
      public void putObject(Object key, Object value) {
        cache.put(key, value);
      }
    
      public Object getObject(Object key) {
        return cache.get(key);
      }
    
      public Object removeObject(Object key) {
        return cache.remove(key);
      }
    
      public void clear() {
        cache.clear();
      }
    
      public ReadWriteLock getReadWriteLock() {
        return null;
      }
    
      public boolean equals(Object o) {
        if (getId() == null) throw new CacheException("Cache instances require an ID.");
        if (this == o) return true;
        if (!(o instanceof Cache)) return false;
    
        Cache otherCache = (Cache) o;
        return getId().equals(otherCache.getId());
      }
    
      public int hashCode() {
        if (getId() == null) throw new CacheException("Cache instances require an ID.");
        return getId().hashCode();
      }
    
    }

  

LruCache实现
----------

利用LinkedHashMap实现了缓存策略。LinkedHashMap能非常方便实现LRU缓存机制，sun api上有详细说明。

    public class LruCache implements Cache {
    
      private final Cache delegate;
      private Map<Object, Object> keyMap;
      private Object eldestKey;
      public LruCache(Cache delegate) {
        this.delegate = delegate;
        setSize(1024);
      }
    
      @Override
      public String getId() {
        return delegate.getId();
      }
    
      @Override
      public int getSize() {
        return delegate.getSize();
      }
    
      public void setSize(final int size) {
        //注意：第三个参数为true，LinkedHashMap会以访问顺序排序，最近使用的排在最前面
        keyMap = new LinkedHashMap<Object, Object>(size, .75F, true) {
          private static final long serialVersionUID = 4267176411845948333L;
          //当put()方法被调用里，这个方法会触发，返回true，eldest将会被删除
          protected boolean removeEldestEntry(Map.Entry<Object, Object> eldest) {
            boolean tooBig = size() > size;
            if (tooBig) {
              //保证被删除的key,下面的cycleKeyList方法有用
              eldestKey = eldest.getKey();
            }
            return tooBig;
          }
        };
      }
    
      //一个新的key加入时，需要检查是否要把旧的删除
      @Override
      public void putObject(Object key, Object value) {
        delegate.putObject(key, value);
        cycleKeyList(key);
      }
    
      @Override
      public Object getObject(Object key) {
        keyMap.get(key); //touch
        return delegate.getObject(key);
      }
    
      @Override
      public Object removeObject(Object key) {
        return delegate.removeObject(key);
      }
    
      @Override
      public void clear() {
        delegate.clear();
        keyMap.clear();
      }
    
      public ReadWriteLock getReadWriteLock() {
        return null;
      }
    
      private void cycleKeyList(Object key) {
        //触发重排序
        keyMap.put(key, key);
        if (eldestKey != null) {
          //删除最旧的那个key
          delegate.removeObject(eldestKey);
          eldestKey = null;
        }
      }
    
    }

  
这两个cache的实现都不是线程安全的，但这个缓存是多个sqlSession共享的，对缓存的访问必须是线程安全的。在下面这个方法里便实现了cache的线程安全。 这个方法在CacheBuilder.build()方法创建cache里被调用。

    private Cache setStandardDecorators(Cache cache) {
        try {
          MetaObject metaCache = SystemMetaObject.forObject(cache);
          if (size != null && metaCache.hasSetter("size")) {
            //设置缓存大小
            metaCache.setValue("size", size);
          }
          if (clearInterval != null) {
            //增加定时清理的功能
            cache = new ScheduledCache(cache);
            ((ScheduledCache) cache).setClearInterval(clearInterval);
          }
          if (readWrite) {
            cache = new SerializedCache(cache);
          }
          //增加日志功能
          cache = new LoggingCache(cache); 
          //实现线程安全，看了SynchronizedCache的源代码之后，有一点没想明白，这个类的同步机制采用了synchronized方法实现，为什么不用ReadWriteLock呢?
          cache = new SynchronizedCache(cache);
          return cache;
        } catch (Exception e) {
          throw new CacheException("Error building standard cache decorators.  Cause: " + e, e);
        }
      }

  

cache-ref节点读取  

================

      private void cacheRefElement(XNode context) {
        if (context != null) {
          //向Configuration注册一个缓存引用
          configuration.addCacheRef(builderAssistant.getCurrentNamespace(), context.getStringAttribute("namespace"));
          CacheRefResolver cacheRefResolver = new CacheRefResolver(builderAssistant, context.getStringAttribute("namespace"));
          try { 
              //获取另一个命名空间的缓存，并加入Configruation中
        	  cacheRefResolver.resolveCacheRef();
          } catch (IncompleteElementException e) {
        	  configuration.addIncompleteCacheRef(cacheRefResolver);
          }
        }
      }

  

    public Cache useCacheRef(String namespace) {
        if (namespace == null) {
          throw new BuilderException("cache-ref element requires a namespace attribute.");
        }
        try {
          unresolvedCacheRef = true;
          //获取加一个命名空间的缓存
          Cache cache = configuration.getCache(namespace);
          if (cache == null) {
            throw new IncompleteElementException("No cache for namespace '" + namespace + "' could be found.");
          }
           //设置当前命名空间的缓存，在之后的解析select/update/insert/delete节点设置缓存里使用currentCache
          currentCache = cache;
          unresolvedCacheRef = false;
          return cache;
        } catch (IllegalArgumentException e) {
          throw new IncompleteElementException("No cache for namespace '" + namespace + "' could be found.", e);
        }
      }

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
