---
title: Mybatis3源码分析之StatementHandler
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-analysis-of-statementhandler
special: m3s
original: false
reproduced: true
date: 2021-05-11 14:35:47
show_title: mybatis3-statementhandler
---

SimpleExecutor执行sql过程
=====================

BoundSql加载完成之后，下一步就可以执行select/update/insert/delete语句了。在SimpleExecutor中执行语句最终会由doQuery和doUpdate方法完成。

     public int doUpdate(MappedStatement ms, Object parameter) throws SQLException {
        Statement stmt = null;
        try {
          Configuration configuration = ms.getConfiguration(); 
          //生成一个StatementHandler
          StatementHandler handler = configuration.newStatementHandler(this, ms, parameter, RowBounds.DEFAULT, null, null);
          //执行之前的准备
          stmt = prepareStatement(handler, ms.getStatementLog());
          //执行sql
          return handler.update(stmt);
        } finally {
          closeStatement(stmt);
        }
      }
    
      public <E> List<E> doQuery(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) throws SQLException {
        Statement stmt = null;
        try {
          Configuration configuration = ms.getConfiguration();
          //生成一个StatementHandler
          StatementHandler handler = configuration.newStatementHandler(wrapper, ms, parameter, rowBounds, resultHandler, boundSql);
          //执行之前的准备
          stmt = prepareStatement(handler, ms.getStatementLog());
          //执行sql
          return handler.<E>query(stmt, resultHandler);
        } finally {
          closeStatement(stmt);
        }
      }

  

    private Statement prepareStatement(StatementHandler handler, Log statementLog) throws SQLException {
        Statement stmt;
        //获取一个连接
        Connection connection = getConnection(statementLog);
        //由StatementHandler从connection获取一个StatementHandler
        stmt = handler.prepare(connection);
        //设置执行参数
        handler.parameterize(stmt);
        return stmt;
      }

  

从以上代码中可以到出Executor是怎么利用StatementHandler执行SQL的

1.  获取一个数据库连接
2.  调用StatementHandler.prepare()方法获取一个statement
3.  调用StatementHandler.parameterize()方法设置sql执行时所需要的参数
4.  调用StatementHandler.update或query方法执行sql

StatementHandler
================

这个接口定义了执行sql的基本操作

    public interface StatementHandler {
      //从连接中获取一个Statement
      Statement prepare(Connection connection)
          throws SQLException;
    
    
      //设置statement执行里所需的参数
      void parameterize(Statement statement)
          throws SQLException;
    
      //批量
      void batch(Statement statement)
          throws SQLException;
    
      //更新：update/insert/delete语句
      int update(Statement statement)
          throws SQLException;
     
      //执行查询
      <E> List<E> query(Statement statement, ResultHandler resultHandler)
          throws SQLException;
    
      BoundSql getBoundSql();
    
      ParameterHandler getParameterHandler();
    
    }

再来看他的类关系图

![](https://img-blog.csdn.net/20151222110355356)  

跟Executor的实现非常相似。

![](https://img-blog.csdn.net/20151222111137138)  

RoutingStatementHandler  

==========================

这个类只是根据MappedStatement的配置，生成一个对应的StatementHandler(delegate),然后所有的实现都由delegate完成。

    private final StatementHandler delegate;
    
      public RoutingStatementHandler(Executor executor, MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {
    
        switch (ms.getStatementType()) {
          case STATEMENT:
            delegate = new SimpleStatementHandler(executor, ms, parameter, rowBounds, resultHandler, boundSql);
            break;
          case PREPARED:
            delegate = new PreparedStatementHandler(executor, ms, parameter, rowBounds, resultHandler, boundSql);
            break;
          case CALLABLE:
            delegate = new CallableStatementHandler(executor, ms, parameter, rowBounds, resultHandler, boundSql);
            break;
          default:
            throw new ExecutorException("Unknown statement type: " + ms.getStatementType());
        }
    
      }

BaseStatementHandler
====================

这个类是一个模板类。其中有两个主要的属性和一个主要的方法。先来看两个属性。

      //处理结果的Handler
      protected final ResultSetHandler resultSetHandler;
      //设置参数的Handler
      protected final ParameterHandler parameterHandler;

  

    public interface ResultSetHandler {
      //转换结果集
      <E> List<E> handleResultSets(Statement stmt) throws SQLException;
    
      void handleOutputParameters(CallableStatement cs) throws SQLException;
    
    }

  

    public interface ParameterHandler {
    
      Object getParameterObject();
      //设置SQL执行的参数
      void setParameters(PreparedStatement ps)
          throws SQLException;
    
    }

  
这ParameterHandler和ResultSetHandler在Mybatis中都只有一个实现：DefaultParameterHandler和DefaultResultSetHandler。之后会有详细有分析。

  

Prepare方法

    public Statement prepare(Connection connection) throws SQLException {
        ErrorContext.instance().sql(boundSql.getSql());
        Statement statement = null;
        try {
          //这个方法是抽象的，由子类实现
          statement = instantiateStatement(connection);
          //设置执行的超时时间
          setStatementTimeout(statement);
          //fetchSize，对大的结果集才有明显的效果
          setFetchSize(statement);
          return statement;
        } catch (SQLException e) {
          closeStatement(statement);
          throw e;
        } catch (Exception e) {
          closeStatement(statement);
          throw new ExecutorException("Error preparing statement.  Cause: " + e, e);
        }
      }

  

BaseStatementHandler子类
======================

1.  PreparedStatementHandler,处理PreparedStatement对象，即带参数运行的SQL,这个类以后详细分析。
2.  CallableStatementHandler,处理CallableStatement对象，即执行过程的SQL,不做讨论。
3.  SimpleStatementHandler,处理Statement对象，即不带参数运行的SQL,不做讨论。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
