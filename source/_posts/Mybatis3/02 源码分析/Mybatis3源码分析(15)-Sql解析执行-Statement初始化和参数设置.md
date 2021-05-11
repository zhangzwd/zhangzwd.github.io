---
title: Mybatis3源码分析之Statement初始化和参数设置
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: >-
  statement-initialization-and-parameter-setting-of-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
date: 2021-05-11 14:40:47
show_title: mybatis3-statement-initialization
---

在SimpleExecutor中，执行SQL时调用preareStatement()方法来对statement进行初始化及参数设置。

       private Statement prepareStatement(StatementHandler handler, Log statementLog) throws SQLException {
        Statement stmt;
        Connection connection = getConnection(statementLog);
        //初始化
        stmt = handler.prepare(connection);
        //参数设置`
        handler.parameterize(stmt);
        return stmt;
      }

这里PreparedStatementHandler为例。详细分析这两个过程。

Statement初始化
============

这是BaseStatementHandler.prepare()方法

    public Statement prepare(Connection connection) throws SQLException {
        ErrorContext.instance().sql(boundSql.getSql());
        Statement statement = null;
        try {
          //通过connection得到一个statement
          statement = instantiateStatement(connection);
          //设置执行超时时间
          setStatementTimeout(statement);
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

再看PreparedStatementHandler.instantiateStatement()方法

    protected Statement instantiateStatement(Connection connection) throws SQLException {
        //被执行的SQL
        String sql = boundSql.getSql();
        if (mappedStatement.getKeyGenerator() instanceof Jdbc3KeyGenerator) {
          String[] keyColumnNames = mappedStatement.getKeyColumns();
          if (keyColumnNames == null) {
            return connection.prepareStatement(sql, PreparedStatement.RETURN_GENERATED_KEYS);
          } else {
            return connection.prepareStatement(sql, keyColumnNames);
          }
        } else if (mappedStatement.getResultSetType() != null) {
          return connection.prepareStatement(sql, mappedStatement.getResultSetType().getValue(), ResultSet.CONCUR_READ_ONLY);
        } else {
          //直接使用jdbc的方式获取了一个PreparedStatement对象
          return connection.prepareStatement(sql);
        }
      }

  

Statement参数设置
=============

如下是PreparedStatementHandler.parameterize()方法

    public void parameterize(Statement statement) throws SQLException {
        //直接调用了ParameterHandler的方法设置
        parameterHandler.setParameters((PreparedStatement) statement);
      }

DefaultParamterHandler.parameterize()方法

    public void setParameters(PreparedStatement ps) throws SQLException {
        ErrorContext.instance().activity("setting parameters").object(mappedStatement.getParameterMap().getId());
        //取出sql中的参数映射列表
        List<ParameterMapping> parameterMappings = boundSql.getParameterMappings();
        if (parameterMappings != null) {
          for (int i = 0; i < parameterMappings.size(); i++) {
            ParameterMapping parameterMapping = parameterMappings.get(i);
            if (parameterMapping.getMode() != ParameterMode.OUT) {
              Object value;
              String propertyName = parameterMapping.getProperty();
              if (boundSql.hasAdditionalParameter(propertyName)) { // issue #448 ask first for additional params
                value = boundSql.getAdditionalParameter(propertyName);
              } else if (parameterObject == null) {
                value = null;
              } else if (typeHandlerRegistry.hasTypeHandler(parameterObject.getClass())) {
                value = parameterObject;
              } else {
                //主要通过MetaObject对象从参数出取数据，MetaObject前面已经详细分析过！
                MetaObject metaObject = configuration.newMetaObject(parameterObject);
                //根据参数名称获取值
                value = metaObject.getValue(propertyName);
              }
              TypeHandler typeHandler = parameterMapping.getTypeHandler();
              JdbcType jdbcType = parameterMapping.getJdbcType();
              if (value == null && jdbcType == null) jdbcType = configuration.getJdbcTypeForNull();
              //调用对应的typeHandler设置参数
              typeHandler.setParameter(ps, i + 1, value, jdbcType);
            }
          }
        }
      }

TypeHandler主要有两个功能：

1.  设置sql执行时的参数
2.  从结果集中取数据

    public interface TypeHandler<T> {
      //设置参数
      void setParameter(PreparedStatement ps, int i, T parameter, JdbcType jdbcType) throws SQLException;
      //取数据
      T getResult(ResultSet rs, String columnName) throws SQLException;
      //取数据
      T getResult(ResultSet rs, int columnIndex) throws SQLException;
      //取数据
      T getResult(CallableStatement cs, int columnIndex) throws SQLException;
    
    }

来看看类关系图就更清楚啦

![](https://img-blog.csdn.net/20151222132641666)

这些都Mybatis内置的TypeHandler，我们也可以自定义一个！处置枚举类型可能很有用。具体的TypeHandler不做讨论。

小结
==

分析到这里，如果是执行update/insert/delete语句，那么整个过程基本上已经完成。如果是执行select语句，还有重要的两步：结果集映射及缓存！

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
