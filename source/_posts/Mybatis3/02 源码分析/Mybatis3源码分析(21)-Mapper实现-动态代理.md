---
title: Mybatis3源码分析之Mapper动态代理
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mapper-dynamic-proxy-for-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:30:47
show_title: mybatis3-mapper-dynamic-proxy
---

当定义好一个Mapper接口(UserDao)里，我们并不需要去实现这个类，但sqlSession.getMapper()最终会返回一个实现该接口的对象。这个对象是Mybatis利用jdk的动态代理实现的。这里将介绍这个代理对象的生成过程及其方法的实现过程。

Mapper代码对象的生成过程
===============

DefaultSqlSession.getMapp()方法最终会调用MapperRegistry.getMapper()方法

     public <T> T getMapper(Class<T> type, SqlSession sqlSession) {
        //这个MapperProxyFactory是调用addMapper方法时加到knownMappers中的，
        final MapperProxyFactory<T> mapperProxyFactory = (MapperProxyFactory<T>) knownMappers.get(type);
        if (mapperProxyFactory == null)
          //说明这个Mapper接口没有注册
          throw new BindingException("Type " + type + " is not known to the MapperRegistry.");
        try {
           //生成一个MapperProxy对象
          return mapperProxyFactory.newInstance(sqlSession);
        } catch (Exception e) {
          throw new BindingException("Error getting mapper instance. Cause: " + e, e);
        }
      }

下面是MapperProxyFactory的newInstance方法

    public T newInstance(SqlSession sqlSession) {
        //创建一个Mapperxy对象，这个方法实现了JDK动态代理中的InvocationHandler接口
        final MapperProxy<T> mapperProxy = new MapperProxy<T>(sqlSession, mapperInterface, methodCache);
        return newInstance(mapperProxy);
      }
    
    protected T newInstance(MapperProxy<T> mapperProxy) {
        //mapperInterface，说明Mapper接口被代理了，这样子返回的对象就是Mapper接口的子类，方法被调用时会被mapperProxy拦截,也就是执行mapperProxy.invoke()方法
        return (T) Proxy.newProxyInstance(mapperInterface.getClassLoader(), new Class[] { mapperInterface }, mapperProxy);
      }

MapperProxy
===========

详细分析一下MapperProxy类

    public class MapperProxy<T> implements InvocationHandler, Serializable {
    
      private static final long serialVersionUID = -6424540398559729838L;
      private final SqlSession sqlSession;
    
      //Mapper接口
      private final Class<T> mapperInterface;
    
      //Mapper接口中的每个方法都会生成一个MapperMethod对象, methodCache维护着他们的对应关系
      //这个methodCache是在MapperProxyFactory中持有的，MapperProxyFactory又是在Configuration中持有的
      //所以每个Mapper接口类对应的MapperProxyFactory和methodCache在整个应用中是共享的，一般只会有一个实例
      private final Map<Method, MapperMethod> methodCache;
    
      public MapperProxy(SqlSession sqlSession, Class<T> mapperInterface, Map<Method, MapperMethod> methodCache) {
        this.sqlSession = sqlSession;
    
        
        this.mapperInterface = mapperInterface;
        this.methodCache = methodCache;
      }
    
    
      //这里会拦截Mapper接口(UserDao)的所有方法
      public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        //如果是Object中定义的方法，直接执行。如toString(),hashCode()等待。
        if (Object.class.equals(method.getDeclaringClass())) {
          try {
            return method.invoke(this, args);
          } catch (Throwable t) {
            throw ExceptionUtil.unwrapThrowable(t);
          }
        }
        //其他Mapper接口定义的方法交由mapperMethod来执行。
        final MapperMethod mapperMethod = cachedMapperMethod(method);
        return mapperMethod.execute(sqlSession, args);
      }
    
      private MapperMethod cachedMapperMethod(Method method) {
        MapperMethod mapperMethod = methodCache.get(method);
        if (mapperMethod == null) {
          mapperMethod = new MapperMethod(mapperInterface, method, sqlSession.getConfiguration());
          methodCache.put(method, mapperMethod);
        }
        return mapperMethod;
      }
    
    }

  

MapperMethod
============

      //所有Mapper接口中方法被调用里，都会执行这个方法.这里实际上是调用SqlSession中的相关方法,
      public Object execute(SqlSession sqlSession, Object[] args) {
        Object result;
        //判断这个方法被注解里的Sql类型
        if (SqlCommandType.INSERT == command.getType()) {
          //执行insert
          Object param = method.convertArgsToSqlCommandParam(args);
          result = rowCountResult(sqlSession.insert(command.getName(), param));
        } else if (SqlCommandType.UPDATE == command.getType()) {
          //执行update
          Object param = method.convertArgsToSqlCommandParam(args);
          result = rowCountResult(sqlSession.update(command.getName(), param));
        } else if (SqlCommandType.DELETE == command.getType()) {
          /delete
          Object param = method.convertArgsToSqlCommandParam(args);
          result = rowCountResult(sqlSession.delete(command.getName(), param));
        } else if (SqlCommandType.SELECT == command.getType()) {
          //select ,查询
          if (method.returnsVoid() && method.hasResultHandler()) {
            //没有返回值，并且有ResultHandler的情况
            executeWithResultHandler(sqlSession, args);
            result = null;
          } else if (method.returnsMany()) {
            //返回一个List
            result = executeForMany(sqlSession, args);
          } else if (method.returnsMap()) {
            //返回一个Map
            result = executeForMap(sqlSession, args);
          } else {
            //返回一个对象
            Object param = method.convertArgsToSqlCommandParam(args);
            result = sqlSession.selectOne(command.getName(), param);
          }
        } else {
          throw new BindingException("Unknown execution method for: " + command.getName());
        }
        if (result == null && method.getReturnType().isPrimitive() && !method.returnsVoid()) {
          throw new BindingException("Mapper method '" + command.getName() 
              + " attempted to return null from a method with a primitive return type (" + method.getReturnType() + ").");
        }
        return result;
      }

  

小结
==

1.  在Mybatis提供的编程接口中，开发人员只需要定义好Mapper接口(如：UserDao)，开发人员无需去实现。Mybatis会利用JDK的动态代理实现 Mapper接口。
2.  在Mybatis中，每个Mapper接口都会对应一个MapperProxyFactory对象实例，这个对应关系在Configuration.mapperRegistry.knownMappers中。
3.  当getMapper()方法被调用时，Mybatis会找到相对应的MapperProxyFactory对象实例，利用这个工厂来创建一个jdk动态代理对象，是这个Mapper接口的实现类,当Mapper定义的方法被调用时，会调用MapperProxy来处理。
4.  MapperProxy会根据方法找到对应的MapperMethod对象来实现这次调用。
5.  MapperMethod对应会读取方法中的注解，从Configuration中找到相对应的MappedStatement对象，再执行。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
