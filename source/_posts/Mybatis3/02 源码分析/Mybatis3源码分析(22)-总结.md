---
title: Mybatis3源码分析之总结
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: summary-of-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 16:30:47
show_title: mybatis3-finish
---

Configuration加载过程
=================

![](https://img-blog.csdn.net/20151229131927349)  

Configuration组成
---------------

1.  基本属性。在mybatis-config.xml加载的属性这里定义为基本属性。如cacheEnabled/variables/objectFactory等等，这些的加载都比较简单。
2.  cache缓存。这个是从mapper配置文件加载的。一个命名空间对应一个缓存。
3.  resultMap。结果集映射，从mapper配置文件中的resultMap节点加载。
4.  mappedStatement。Sql语句的定义。从mapper配置文件中的select/update/insert/delete节点加载。

之所以将cache/resultMap/mapperStatement单独分开，是因为我们在配置mybatis中主要使用的就是这三个配置。

  

Configuration加载
---------------

1.  XMLConfigBuilder读取mybatis-config.xml文件，解析内容并加载到configuration中基本属性中。
2.  XMLMapperBuilder读取Mapper配置文件，解析得到配置内容。如果是加载Mapper接口的话由MapperAnnotationBuilder从注解里解析配置内容。
3.  MapperBuilderAssistant利用XMLMapperBulider/XMLAnnotationBuilder解析到的配置构建Cache/ResultMap/MappedStatement对象并加载到Configuration中。

SQL执行过程
=======

![](https://img-blog.csdn.net/20151229131912319)  

  

主要对象
----

1.  Mybatis在SqlSession接口中提供了访问数据库的基本操作。如select/update/insert/delete/commit/rollback/close。SqlSession有一个默认的实现DefaultSqlSession
2.  在DefaultSqlSession中有一个Executor对象，对象数据的操作都是由这个Executor来完成。Executor中有三个对象来帮助他完成MappedStatement的执行工作。
3.  StatementHandler负责从连接中获取一个Statement对象
4.  ParameterHandler负责对Statement设置参数
5.  ResultHandler负责生成查询语句的结果集

主要过程
----

1.  DefaultSqlSession根据id在configuration中找到MappedStatement对象(要执行的语句)
2.  Executor调用MappedStatement对象的getBoundSql得到可执行的sql和参数列表
3.  StatementHandler根据Sql生成一个Statement
4.  ParameterHandler为Statement设置相应的参数
5.  Executor中执行sql语句
6.  如果是更新(update/insert/delete)语句，sql的执行工作得此结束
7.  如果是查询语句，ResultSetHandler再根据执行结果生成ResultMap相应的对象返回。

Mybatis使用到的主要的设计模式
==================

1.  装饰模式。在实现Executor、Cache等接口时，Mybatis都使用了装饰模式。
2.  模板模式。在看过很多框架的源都使用了这种模式。模板模式将面向对象的特性发挥到了极致。
3.  外观模式。外观模式提供了统一的接口给客户端使用。为以后的系统或功能扩展提供了便利性。

以上三种设计是Mybatis中非常重要的设计模式，我们应该了解并深入研究，在实际应用中使用。

其他
==

1.  Mybatis用jdk的动态代理实现了拦截器和Mapper接口。这种动态代理和注解的运用也是非常值得学习的。
2.  SqlSession在一个生命周期中会产生大量的临时对象，如：Executor、Transaction、Cache、MetaObject、StatementHandler、ParameterHandler、ResultSetHandler等待。但是SqlSession的生命周期是非常短的。这样造成大量对象的产生，给JVM的GC工作带来了很多的消耗，这个应该是Mybatis比较大的缺点了。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
