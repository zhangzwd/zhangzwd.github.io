---
title: Mybatis3源码分析之BoundSql的加载-2
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title:  mybatis3-source-code-analysis-of-boundsql-load---2
special: m3s
original: false
reproduced: true
date: 2021-05-11 13:30:47
show_title: mybatis3-boundsql-load-2
---

前面分析到SqlNode.apply()后，Sql还是个半成品。只处理了"${}"这种占位符，"#{}"这种占位符还没有处理，而且Sql执行时的参数也没有生成。

再来看DynamicSqlSource.getBoundSql()方法

       public BoundSql getBoundSql(Object parameterObject) {
        DynamicContext context = new DynamicContext(configuration, parameterObject);
        //这里只处理了"${}"占位符
        rootSqlNode.apply(context);
        SqlSourceBuilder sqlSourceParser = new SqlSourceBuilder(configuration);
        Class<?> parameterType = parameterObject == null ? Object.class : parameterObject.getClass();
        //这里就是处理"#{}"占位符的地方
        SqlSource sqlSource = sqlSourceParser.parse(context.getSql(), parameterType, context.getBindings());
        //这个BoundSql就是数据库可执行的Sql,同时还包含了运行时的参数。
        BoundSql boundSql = sqlSource.getBoundSql(parameterObject);
        for (Map.Entry<String, Object> entry : context.getBindings().entrySet()) {
          boundSql.setAdditionalParameter(entry.getKey(), entry.getValue());
        }
        return boundSql;
      }

sqlSourceParser.parse()方法，处理方式跟前面处理"${}"占位符的基本一致。

    public SqlSource parse(String originalSql, Class<?> parameterType, Map<String, Object> additionalParameters) {
        //处理占位符的handler
        ParameterMappingTokenHandler handler = new ParameterMappingTokenHandler(configuration, parameterType, additionalParameters);
        //要处理什么样的占位符
        GenericTokenParser parser = new GenericTokenParser("#{", "}", handler);
        //开始处理
        String sql = parser.parse(originalSql); 
        //这个SqlSource就是一个简单的java对象
        return new StaticSqlSource(configuration, sql, handler.getParameterMappings());
      }

再来看ParameterMappingTokenHandler是怎么处理占位符的

     public String handleToken(String content) {
          //从参数中获取具体的值，并加入parameterMappings中
          parameterMappings.add(buildParameterMapping(content));
         //直接替换成一个"?"
         //这里可以看到有多少个"#{}"占位符，就会生成对应个"?",同时还会生成对应的parameterMappings
          return "?";
        }
    
        private ParameterMapping buildParameterMapping(String content) {
          //这里content可以是这样子的:#{height,javaType=double,jdbcType=NUMERIC,numericScale=2}
          //parseParameterMapping()就是把这种复杂的复杂解析成Map方式
          Map<String, String> propertiesMap = parseParameterMapping(content);
          String property = propertiesMap.get("property");
          //解析参数的类型,String,int or boolean ...
          Class<?> propertyType;
          if (metaParameters.hasGetter(property)) { // issue #448 get type from additional params
            //在这里大部分的应该都能确定下来
            propertyType = metaParameters.getGetterType(property);
          } else if (typeHandlerRegistry.hasTypeHandler(parameterType)) {
            propertyType = parameterType;
          } else if (JdbcType.CURSOR.name().equals(propertiesMap.get("jdbcType"))) {
            propertyType = java.sql.ResultSet.class;
          } else if (property != null) {
            MetaClass metaClass = MetaClass.forClass(parameterType);
            if (metaClass.hasGetter(property)) {
              propertyType = metaClass.getGetterType(property);
            } else {
              propertyType = Object.class;
            }
          } else {
            propertyType = Object.class;
          }
          //构建一个ParameterMapping对象，ParameterMapping描述的是java对象的属性与sql执行参数的对应关系。跟ResultMapping对象差不多
          ParameterMapping.Builder builder = new ParameterMapping.Builder(configuration, property, propertyType);
          Class<?> javaType = propertyType;
          String typeHandlerAlias = null;
          for (Map.Entry<String, String> entry : propertiesMap.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            //示例:#{height,javaType=double,jdbcType=NUMERIC,numericScale=2}
            if ("javaType".equals(name)) {
              javaType = resolveClass(value);
              builder.javaType(javaType);
            } else if ("jdbcType".equals(name)) {
              builder.jdbcType(resolveJdbcType(value));
            } else if ("mode".equals(name)) {
              builder.mode(resolveParameterMode(value));
            } else if ("numericScale".equals(name)) {
              builder.numericScale(Integer.valueOf(value));
            } else if ("resultMap".equals(name)) {
              builder.resultMapId(value);
            } else if ("typeHandler".equals(name)) {
              typeHandlerAlias = value;
            } else if ("jdbcTypeName".equals(name)) {
              builder.jdbcTypeName(value);
            } else if ("property".equals(name)) {
              // Do Nothing
            } else if ("expression".equals(name)) {
              throw new BuilderException("Expression based parameters are not supported yet");
            } else {
              throw new BuilderException("An invalid property '" + name + "' was found in mapping #{" + content + "}.  Valid properties are " + parameterProperties);
            }
          }
          if (typeHandlerAlias != null) {
            builder.typeHandler(resolveTypeHandler(javaType, typeHandlerAlias));
          }
          return builder.build();
        }

  
分析到这里，SqlSession在执行sql里已经生成了BoundSql：可执行的sql及相应的参数。下一步应该就是直接操作数据库了，如生成Statement，执行参数等等。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
