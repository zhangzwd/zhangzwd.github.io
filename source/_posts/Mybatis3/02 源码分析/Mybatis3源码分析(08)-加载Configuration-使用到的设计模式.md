---
title: Mybatis3源码分析之加载Configuration使用到的设计模式
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: >-
  mybatis3-source-code-analysis-of-loading-configuration-to-use-the-design-pattern
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:40:47
show_title: mybatis3-configuration-pattern
---

设计模式无处不在，在分析Mybatis加载Configuration的过程中，发现Mybatis使用了多种的设计模式。

工厂模式
====

下面的例子准确的来说是一个抽象工厂！

Configuration中有个属性:

    protected ObjectFactory objectFactory = new DefaultObjectFactory();

  
Mybatis使用这个工厂去创建所有需要被创建的对象。

    /**
     * MyBatis uses an ObjectFactory to create all needed new Objects.
     * 
     * @author Clinton Begin
     */

  
其最主要的一个方法，也就是俗称的工厂方法:

    /**
       * Creates a new object with the specified constructor and params.
       * @param type Object type
       * @param constructorArgTypes Constructor argument types
       * @param constructorArgs Constructor argument values
       * @return
       */
      <T> T create(Class<T> type, List<Class<?>> constructorArgTypes, List<Object> constructorArgs);

这个方法主要是根据Class对象去创建实例，可以肯定这个方法的实现需要使用java的反射机制。

再看这个方法的默认实现:

    public <T> T create(Class<T> type, List<Class<?>> constructorArgTypes, List<Object> constructorArgs) {
        Class<?> classToCreate = resolveInterface(type);
        @SuppressWarnings("unchecked")
        // we know types are assignable
        T created = (T) instantiateClass(classToCreate, constructorArgTypes, constructorArgs);
        return created;
      }

  

    private <T> T instantiateClass(Class<T> type, List<Class<?>> constructorArgTypes, List<Object> constructorArgs) {
        try {
          Constructor<T> constructor;
          if (constructorArgTypes == null || constructorArgs == null) {
            //使用不带参数的构造方法
            constructor = type.getDeclaredConstructor();
            if (!constructor.isAccessible()) {
              constructor.setAccessible(true);
            }
            //利用反射构建对象
            return constructor.newInstance();
          } 
          //带参的构造方法
          constructor = type.getDeclaredConstructor(constructorArgTypes.toArray(new Class[constructorArgTypes.size()]));
          if (!constructor.isAccessible()) {
            constructor.setAccessible(true);
          }
           //利用反射构建对象
          return constructor.newInstance(constructorArgs.toArray(new Object[constructorArgs.size()]));
        } catch (Exception e) {
          StringBuilder argTypes = new StringBuilder();
          if (constructorArgTypes != null) {
            for (Class<?> argType : constructorArgTypes) {
              argTypes.append(argType.getSimpleName());
              argTypes.append(",");
            }
          }
          StringBuilder argValues = new StringBuilder();
          if (constructorArgs != null) {
            for (Object argValue : constructorArgs) {
              argValues.append(String.valueOf(argValue));
              argValues.append(",");
            }
          }
          throw new ReflectionException("Error instantiating " + type + " with invalid types (" + argTypes + ") or values (" + argValues + "). Cause: " + e, e);
        }
      }

我们完全可以实现一个ObjectFactory，通过如下配置让Mybatis使用自定义的ObjectFacotry

    <!-- mybatis-config.xml -->
    <objectFactory type="com.ashan.mybatis.AshanObjectFactory">
      <property name="myProperty" value="myvalue"/>
    </objectFactory>

构建者(Builder)模式
==============

还记得XMLMapperBuilder的助手MapperBuilderAssisant吗？他就是使用构建者模式来创建ResultMap/ResultMapping/MappedStatement/Cache对象的，应该说是这个类提供了构建者模式给MapperBuilderAssisant使用。如ResultMapp.Builder：

    public ResultMap build() {
          if (resultMap.id == null) {
            throw new IllegalArgumentException("ResultMaps must have an id");
          }
          resultMap.mappedColumns = new HashSet<String>();
          resultMap.idResultMappings = new ArrayList<ResultMapping>();
          resultMap.constructorResultMappings = new ArrayList<ResultMapping>();
          resultMap.propertyResultMappings = new ArrayList<ResultMapping>();
          for (ResultMapping resultMapping : resultMap.resultMappings) {
            resultMap.hasNestedQueries = resultMap.hasNestedQueries || resultMapping.getNestedQueryId() != null;
            resultMap.hasNestedResultMaps = resultMap.hasNestedResultMaps || (resultMapping.getNestedResultMapId() != null && resultMapping.getResultSet() == null);
            final String column = resultMapping.getColumn();
            if (column != null) {
              resultMap.mappedColumns.add(column.toUpperCase(Locale.ENGLISH));
            } else if (resultMapping.isCompositeResult()) {
              for (ResultMapping compositeResultMapping : resultMapping.getComposites()) {
                final String compositeColumn = compositeResultMapping.getColumn();
                if (compositeColumn != null) {
                  resultMap.mappedColumns.add(compositeColumn.toUpperCase(Locale.ENGLISH));
                }
              }
            }
            if (resultMapping.getFlags().contains(ResultFlag.CONSTRUCTOR)) {
              resultMap.constructorResultMappings.add(resultMapping);
            } else {
              resultMap.propertyResultMappings.add(resultMapping);
            }
            if (resultMapping.getFlags().contains(ResultFlag.ID)) {
              resultMap.idResultMappings.add(resultMapping);
            }
          }
          if (resultMap.idResultMappings.isEmpty()) {
            resultMap.idResultMappings.addAll(resultMap.resultMappings);
          }
          // lock down collections
          resultMap.resultMappings = Collections.unmodifiableList(resultMap.resultMappings);
          resultMap.idResultMappings = Collections.unmodifiableList(resultMap.idResultMappings);
          resultMap.constructorResultMappings = Collections.unmodifiableList(resultMap.constructorResultMappings);
          resultMap.propertyResultMappings = Collections.unmodifiableList(resultMap.propertyResultMappings);
          resultMap.mappedColumns = Collections.unmodifiableSet(resultMap.mappedColumns);
          return resultMap;
        }

从上的代码来看，这个build方法比较复杂一些！

这里就都看出工厂模式与构建者模式的一个区别：工厂模式一般都是构建简单的对象，而构建者模式用来构建比较复杂的对象，不单要实例化对象，还要进行初始化、校验及其他工作。

装饰器模式
=====

Mybatis中的Cache对象就是利用装饰器模式实现的，非常精彩！装饰器模式一般有三种角色

1.   抽象类(方法)
2.  原始实现类
3.  装饰实现类-利用原始实现类去实现抽象类的同时增加新功能。这个类持有一个原始实现对象，同时也实现了抽象类。

![](https://img-blog.csdn.net/20151219181655713)  

Mybatis中的Cache即为一个抽象接口

    public interface Cache {
    
      /**
       * @return The identifier of this cache
       */
      String getId();
    
      /**
       * @param key Can be any object but usually it is a {@link CacheKey}
       * @param value The result of a select.
       */
      void putObject(Object key, Object value);
    
      /**
       * @param key The key
       * @return The object stored in the cache.
       */
      Object getObject(Object key);
    
      /**
       * Optional. It is not called by the core.
       * 
       * @param key The key
       * @return The object that was removed
       */
      Object removeObject(Object key);
    
      /**
       * Clears this cache instance
       */  
      void clear();
    
      /**
       * Optional. This method is not called by the core.
       * 
       * @return The number of elements stored in the cache (not its capacity).
       */
      int getSize();
      
      /** 
       * Optional. As of 3.2.6 this method is no longer called by the core.
       *  
       * Any locking needed by the cache must be provided internally by the cache provider.
       * 
       * @return A ReadWriteLock 
       */
      ReadWriteLock getReadWriteLock();
    
    }

  
PerpetualCache即为原始的实现。

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

对Cache的装饰实现在Mybatis中就有很多了，打开类关系图可以看到

![](https://img-blog.csdn.net/20151219182211383)

上图中除了PerpetualCache其他都是利用装饰模式实现Cache的。我们来看一个最简单的SynchronizedCache，这个类提供了线程安全的访问。

    public class SynchronizedCache implements Cache {
      //真正实现Cache还得靠这个家伙,这个类只会把精力集中在线程安全上。
      private Cache delegate;
      
      public SynchronizedCache(Cache delegate) {
        this.delegate = delegate;
      }
    
      @Override
      public String getId() {
        return delegate.getId();
      }
    
      @Override
      public synchronized int getSize() {
        return delegate.getSize();
      }
      
    
      //只是用了synchronized关键字
      @Override
      public synchronized void putObject(Object key, Object object) {
        delegate.putObject(key, object);
      }
    
      @Override
      public synchronized Object getObject(Object key) {
        return delegate.getObject(key);
      }
    
      @Override
      public synchronized Object removeObject(Object key) {
        return delegate.removeObject(key);
      }
    
      @Override
      public synchronized void clear() {
        delegate.clear();
      }
    
      @Override
      public int hashCode() {
        return delegate.hashCode();
      }
    
      @Override
      public boolean equals(Object obj) {
        return delegate.equals(obj);
      }
    
      @Override
      public ReadWriteLock getReadWriteLock() {
        return null;
      }
    
    }

这里可以看出，装饰模式就是流水线的加工一样，使用原材料并加入特定的功能，这样经过整条流水线一来，产品的功能将越来越丰富。

模板模式
====

模板模式就是由父类(一般是抽象类，也叫模板类)提供一些实用的模板方法给子类使用。Spring提供的各种DaoSupport就是利用了模板模式，这样使用子类实现起来非常的爽。同时模板方法也会定义一些重要的业务流程，并且声明为final，这样方便子类的同时也约定了子类的行为。Spring中的事务管理就有这样子的运用。

在Mybatis中的XMLConfigBuilder和XMLMapperBuilder及他的助手就是用模板模式实现的。

来看看这几个类的关系图

![](https://img-blog.csdn.net/20151219184741118)  

这个BaseBuilder就是一个模板类，提供了很多模板方法。子类有实现功能时都会用到这学模板方法。

     //模板类一般是抽象的
     public abstract class BaseBuilder {
      protected final Configuration configuration;
      protected final TypeAliasRegistry typeAliasRegistry;
      protected final TypeHandlerRegistry typeHandlerRegistry;
    
      public BaseBuilder(Configuration configuration) {
        this.configuration = configuration;
        this.typeAliasRegistry = this.configuration.getTypeAliasRegistry();
        this.typeHandlerRegistry = this.configuration.getTypeHandlerRegistry();
      }
    
      public Configuration getConfiguration() {
        return configuration;
      }
    
      //如下定义的全部都是模板方法，给子类提供了便利
      protected Boolean booleanValueOf(String value, Boolean defaultValue) {
        return value == null ? defaultValue : Boolean.valueOf(value);
      }
    
      protected Integer integerValueOf(String value, Integer defaultValue) {
        return value == null ? defaultValue : Integer.valueOf(value);
      }
    
      protected Set<String> stringSetValueOf(String value, String defaultValue) {
        value = (value == null ? defaultValue : value);
        return new HashSet<String>(Arrays.asList(value.split(",")));
      }
    
      protected JdbcType resolveJdbcType(String alias) {
        if (alias == null) return null;
        try {
          return JdbcType.valueOf(alias);
        } catch (IllegalArgumentException e) {
          throw new BuilderException("Error resolving JdbcType. Cause: " + e, e);
        }
      }
    
      protected ResultSetType resolveResultSetType(String alias) {
        if (alias == null) return null;
        try {
          return ResultSetType.valueOf(alias);
        } catch (IllegalArgumentException e) {
          throw new BuilderException("Error resolving ResultSetType. Cause: " + e, e);
        }
      }
    
      protected ParameterMode resolveParameterMode(String alias) {
        if (alias == null) return null;
        try {
          return ParameterMode.valueOf(alias);
        } catch (IllegalArgumentException e) {
          throw new BuilderException("Error resolving ParameterMode. Cause: " + e, e);
        }
      }
    
      protected Object createInstance(String alias) {
        Class<?> clazz = resolveClass(alias);
        if (clazz == null) return null;
        try {
          return resolveClass(alias).newInstance();
        } catch (Exception e) {
          throw new BuilderException("Error creating instance. Cause: " + e, e);
        }
      }
    
      protected Class<?> resolveClass(String alias) {
        if (alias == null) return null;
        try {
          return resolveAlias(alias);
        } catch (Exception e) {
          throw new BuilderException("Error resolving class. Cause: " + e, e);
        }
      }
    
      protected TypeHandler<?> resolveTypeHandler(Class<?> javaType, String typeHandlerAlias) {
        if (typeHandlerAlias == null) return null;
        Class<?> type = resolveClass(typeHandlerAlias);
        if (type != null && !TypeHandler.class.isAssignableFrom(type)) {
          throw new BuilderException("Type " + type.getName() + " is not a valid TypeHandler because it does not implement TypeHandler interface");
        }
        @SuppressWarnings( "unchecked" ) // already verified it is a TypeHandler
        Class<? extends TypeHandler<?>> typeHandlerType = (Class<? extends TypeHandler<?>>) type;
        return resolveTypeHandler(javaType, typeHandlerType);
      }
    
      protected TypeHandler<?> resolveTypeHandler(Class<?> javaType, Class<? extends TypeHandler<?>> typeHandlerType) {
        if (typeHandlerType == null) return null;
        // javaType ignored for injected handlers see issue #746 for full detail
        TypeHandler<?> handler = typeHandlerRegistry.getMappingTypeHandler(typeHandlerType);
        if (handler == null) {
          // not in registry, create a new one
          handler = typeHandlerRegistry.getInstance(javaType, typeHandlerType);
        }
        return handler;
      }
    
      protected Class<?> resolveAlias(String alias) {
        return typeAliasRegistry.resolveAlias(alias);
      }
    }

  

组合模式
====

组合模式就是把多个对象组合成一个对象，简化对多个对象的访问。

看看Mybatis的SqlNode类

    public interface SqlNode {
      boolean apply(DynamicContext context);
    }

一条Sql会被解析成多个SqlNode对象，有IfSqlNode、TextSqlNode、ForEachSqlNode，那么访问这条sql时是不是要对每一个sqlNode都访问呢？

Mybatis提供了一个MixedSqlNode,将多个SqlNode组合成一个。

    public class MixedSqlNode implements SqlNode {
      private List<SqlNode> contents;
    
      public MixedSqlNode(List<SqlNode> contents) {
        this.contents = contents;
      }
    
      public boolean apply(DynamicContext context) {
        for (SqlNode sqlNode : contents) {
          sqlNode.apply(context);
        }
        return true;
      }
    }

  
这里可以看出，组合模式可以简单化对多个对象的访问。Dom4J中对XML的定义也可以说是用了组合模式。

  

外观模式
====

外观模式是提供统一接口给客户端访问，使用所有的客户都有相同的功能。这个做一个最大的好处就是以后的功能扩展。

在Configuration中一组newExecutor、newMetaObject、newStatementHandler、newResultSetHandler、newParameterHandler方法，其他类需要这些对象时都使用这些方法创建。

    public MetaObject newMetaObject(Object object) {
        return MetaObject.forObject(object, objectFactory, objectWrapperFactory);
      }
    
      public ParameterHandler newParameterHandler(MappedStatement mappedStatement, Object parameterObject, BoundSql boundSql) {
        ParameterHandler parameterHandler = mappedStatement.getLang().createParameterHandler(mappedStatement, parameterObject, boundSql);
        parameterHandler = (ParameterHandler) interceptorChain.pluginAll(parameterHandler);
        return parameterHandler;
      }
    
      public ResultSetHandler newResultSetHandler(Executor executor, MappedStatement mappedStatement, RowBounds rowBounds, ParameterHandler parameterHandler,
          ResultHandler resultHandler, BoundSql boundSql) {
        ResultSetHandler resultSetHandler = new DefaultResultSetHandler(executor, mappedStatement, parameterHandler, resultHandler, boundSql, rowBounds);
        resultSetHandler = (ResultSetHandler) interceptorChain.pluginAll(resultSetHandler);
        return resultSetHandler;
      }
    
      public StatementHandler newStatementHandler(Executor executor, MappedStatement mappedStatement, Object parameterObject, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {
        StatementHandler statementHandler = new RoutingStatementHandler(executor, mappedStatement, parameterObject, rowBounds, resultHandler, boundSql);
        statementHandler = (StatementHandler) interceptorChain.pluginAll(statementHandler);
        return statementHandler;
      }
    
      public Executor newExecutor(Transaction transaction) {
        return newExecutor(transaction, defaultExecutorType);
      }
    
      public Executor newExecutor(Transaction transaction, ExecutorType executorType) {
        executorType = executorType == null ? defaultExecutorType : executorType;
        executorType = executorType == null ? ExecutorType.SIMPLE : executorType;
        Executor executor;
        if (ExecutorType.BATCH == executorType) {
          executor = new BatchExecutor(this, transaction);
        } else if (ExecutorType.REUSE == executorType) {
          executor = new ReuseExecutor(this, transaction);
        } else {
          executor = new SimpleExecutor(this, transaction);
        }
        if (cacheEnabled) {
          executor = new CachingExecutor(executor);
        }
        executor = (Executor) interceptorChain.pluginAll(executor);
        return executor;
      }

  
再来看看其中的newMetaObject方法都有哪些调用者

  

![](https://img-blog.csdn.net/20151230100225325)  

这样做的一个好处就是需要扩展MetaObject类时，只需要修改newMetaObject方法即可，不用修改如此多的调用者代码。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
