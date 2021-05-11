---
title: Mybatis3源码分析之Configuration总结
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: summary-of-mybatis3-source-code-analysis
special: m3s
original: false
reproduced: true
show_title: mybatis3-configuration-finish
date: 2021-05-11 13:35:47
---

Configuration中的配置信息
===================

下图是官方文档中对Configuration的介绍

![](https://img-blog.csdn.net/20151219085115235)  

这里xml配置是由两个对象加载Configuration对象中

1.  XMLConfigBuilder。这个对象负责加载除mappers映射器之外的所有配置。
2.  XMLMapperBuilder。这个对象只负责加载mappers映射器中的配置。其中他还有个助手:MapperBuilderAssisant。XMLMapperBuilder与MapperBuilderAssisant有明确的分工。

XMLConfigBuilder加载配置
====================

这个加载过程比较简单，主要是读取配置，再创建对象，最后把对象加入Configruation中。而创建对象主要有两方式:

1.  通过类名加载对象。
    
    1.  从配置中加载类名或类的别名
    2.  通过类名实例化对象
    3.  设置对象属性
    4.  将对象加入Configuration中
    
    如下例：
    
         
           //解析对象工厂
           private void objectFactoryElement(XNode context) throws Exception {
            if (context != null) {
             //从配置中读取类名
              String type = context.getStringAttribute("type");
              //从配置中读取改造
              Properties properties = context.getChildrenAsProperties();
              //根据类名创建对象
              ObjectFactory factory = (ObjectFactory) resolveClass(type).newInstance();
             //设置对象属性
              factory.setProperties(properties);
              //加入到Configuration中
              configuration.setObjectFactory(factory);
            }
          }
    
      
    
2.  通过配置的内容(字符串)加载对象。这种对象一般都结构简单的，如枚举类型，Boolean类型等.
    
    1.  读取配置的字符串内容
    2.  调用valueOf方法得一个对象
    
    如下例:
    
        configuration.setAutoMappingBehavior(AutoMappingBehavior.valueOf(props.getProperty("autoMappingBehavior", "PARTIAL")));
    

XMLMapperBuilder加载配置
====================

XMLMapperBuilder主要加载如下三个配置，其他的比较少用。

1.  cache
2.  resultMap
3.  select/update/insert/delete

  

XMLMapperBuillder的助手XMLMapperAssiant
------------------------------------

一个XMLMapperBuilder就会有一个助手。两个对象有明确的分工。XMLMapperBuilder对象负责从XML读取配置，而他的助手负责创建对象并加载到Configuration中。例如：

    private ResultMapping buildResultMappingFromContext(XNode context, Class<?> resultType, ArrayList<ResultFlag> flags) throws Exception {
        //XMLapperBuilder负责从xml读取配置
        String property = context.getStringAttribute("property");
        String column = context.getStringAttribute("column");
        String javaType = context.getStringAttribute("javaType");
        String jdbcType = context.getStringAttribute("jdbcType");
        String nestedSelect = context.getStringAttribute("select");
        String nestedResultMap = context.getStringAttribute("resultMap",
            processNestedResultMappings(context, Collections.<ResultMapping> emptyList()));
        String notNullColumn = context.getStringAttribute("notNullColumn");
        String columnPrefix = context.getStringAttribute("columnPrefix");
        String typeHandler = context.getStringAttribute("typeHandler");
        String resulSet = context.getStringAttribute("resultSet");
        String foreignColumn = context.getStringAttribute("foreignColumn");
        boolean lazy = "lazy".equals(context.getStringAttribute("fetchType", configuration.isLazyLoadingEnabled() ? "lazy" : "eager"));
        Class<?> javaTypeClass = resolveClass(javaType);
        @SuppressWarnings("unchecked")
        Class<? extends TypeHandler<?>> typeHandlerClass = (Class<? extends TypeHandler<?>>) resolveClass(typeHandler);
        JdbcType jdbcTypeEnum = resolveJdbcType(jdbcType);
        //助手负责创建对象并加入Configuration
        return builderAssistant.buildResultMapping(resultType, property, column, javaTypeClass, jdbcTypeEnum, nestedSelect, nestedResultMap, notNullColumn, columnPrefix, typeHandlerClass, flags, resulSet, foreignColumn, lazy);
      }

这个助手创建对象时，利用对象提供的build()方法，这是构建者模式，这种模式负责构建复杂的对象

    public ParameterMapping buildParameterMapping(
          Class<?> parameterType,
          String property,
          Class<?> javaType,
          JdbcType jdbcType,
          String resultMap,
          ParameterMode parameterMode,
          Class<? extends TypeHandler<?>> typeHandler,
          Integer numericScale) {
        resultMap = applyCurrentNamespace(resultMap, true);
    
        // Class parameterType = parameterMapBuilder.type();
        Class<?> javaTypeClass = resolveParameterJavaType(parameterType, property, javaType, jdbcType);
        TypeHandler<?> typeHandlerInstance = resolveTypeHandler(javaTypeClass, typeHandler);
         //利用Builder来创建对象
        ParameterMapping.Builder builder = new ParameterMapping.Builder(configuration, property, javaTypeClass);
        builder.jdbcType(jdbcType);
        builder.resultMapId(resultMap);
        builder.mode(parameterMode);
        builder.numericScale(numericScale);
        builder.typeHandler(typeHandlerInstance);
        return builder.build();
      }

Configuration中默认的Cache对象
========================

Cache对象采用装饰模式实现，对PerpetualCache层层装饰，实现最终需要实现的功能

![](https://img-blog.csdn.net/20151219132913600)  

  

Configuration中的resultMaps属性
===========================

![](https://img-blog.csdn.net/20151219141032756)  

1.  一个resultMap元素对应一个ResultMap对象
2.  resultMap元素中的idArg/id/result/association/collection元素对应一个ResultMapping对象，所有resultMap会有多个ResultMapping对象
3.  association/collection元素对应一个内映射的ResultMap  
    
4.  不管是ResultMap对应还是内映射的ResultMap对象都会被加入到Configuration.resultMaps属性

Configuration.mappedStatements属性
================================

select/update/insert/detele元素会被解析成一个MappedStatement对象，这个对象有一个SqlSource属性，这个属性代表了sql具体的定义。SqlSource又由多个SqlNode组成，这个SqlNode是用组合模式实现的。BoundSql和SqlNode对象在以后分析sql执行时再讨论。

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
