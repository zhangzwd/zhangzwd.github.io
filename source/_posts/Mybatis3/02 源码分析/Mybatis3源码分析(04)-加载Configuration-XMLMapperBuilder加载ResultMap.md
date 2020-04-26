---
title: MyBatis3源码之XMLMapperBuilder加载ResultMap过程
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: xmlmapperbuilder-of-mybatis3-source-code-loading-resultmap-process
special: m3s
original: false
reproduced: true
date: 2020-03-28 14:05:16
show_title: mybatis3-source-xmlmapperbuilder
---

### XMLMapperBuilder.parse()方法  

XMLConfigBuilder在解析过程中碰到mappers元素会交由XMLMapperBuilder.parse()方法来处理

```java
public void parse() {
    if (!configuration.isResourceLoaded(resource)) {
        //真正解析
        configurationElement(parser.evalNode("/mapper"));
        configuration.addLoadedResource(resource);
        bindMapperForNamespace();
    }

    parsePendingResultMaps();
    parsePendingChacheRefs();
    parsePendingStatements();
}
```

 


```java
 private void configurationElement(XNode context) {
    try {
      String namespace = context.getStringAttribute("namespace");
      //在Mybatis3中mapper元素必须定义命名空间
      if (namespace.equals("")) {
    	  throw new BuilderException("Mapper's namespace cannot be empty");
      }
      builderAssistant.setCurrentNamespace(namespace);
      
      //缓存,以后再看
      cacheRefElement(context.evalNode("cache-ref"));
      cacheElement(context.evalNode("cache"));
      //解析parameterMap节点，Mybatis3中官方已经不推荐使用parameterMap配置，这里也不做讨论
      parameterMapElement(context.evalNodes("/mapper/parameterMap"));
      
      //解析resultMap
      resultMapElements(context.evalNodes("/mapper/resultMap"));
      sqlElement(context.evalNodes("/mapper/sql"));

      //解析sql
      buildStatementFromContext(context.evalNodes("select|insert|update|delete"));
    } catch (Exception e) {
      throw new BuilderException("Error parsing Mapper XML. Cause: " + e, e);
    }
  }
```



### 解析resultMap节点


```java
private ResultMap resultMapElement(XNode resultMapNode, List<ResultMapping> additionalResultMappings) throws Exception {
    ErrorContext.instance().activity("processing " + resultMapNode.getValueBasedIdentifier());
    //id,对应ResultMap.id,内映射没有ID,用<span style="font-family: Arial, Helvetica, sans-serif; font-size: 12px;">resultMapNode.getValueBasedIdentifier()方法生成一个</span>
    String id = resultMapNode.getStringAttribute("id",
                                                 resultMapNode.getValueBasedIdentifier());
    //type,对应ResultMap.Type,这里可以看到这个type可以通过很多个属性进行配置
    String type = resultMapNode.getStringAttribute("type",
                                                   resultMapNode.getStringAttribute("ofType",
                                                                                    resultMapNode.getStringAttribute("resultType",
                                                                                                                     resultMapNode.getStringAttribute("javaType"))));
    String extend = resultMapNode.getStringAttribute("extends");
    //是否自动映射
    Boolean autoMapping = resultMapNode.getBooleanAttribute("autoMapping");

    //将type解析成class,可以是别名，也可以是全限定名
    Class<?> typeClass = resolveClass(type);
    Discriminator discriminator = null;
    //这个resultMappings将对应ResultMap.resultMappings
    List<ResultMapping> resultMappings = new ArrayList<ResultMapping>();
    resultMappings.addAll(additionalResultMappings);
    List<XNode> resultChildren = resultMapNode.getChildren();
    for (XNode resultChild : resultChildren) {//解析子节点
        if ("constructor".equals(resultChild.getName())) {
            //解析constructor节点
            processConstructorElement(resultChild, typeClass, resultMappings);
        } else if ("discriminator".equals(resultChild.getName())) {
            //解析disriminator节点，暂时不讨论
            discriminator = processDiscriminatorElement(resultChild, typeClass, resultMappings);
        } else {
            ArrayList<ResultFlag> flags = new ArrayList<ResultFlag>();
            if ("id".equals(resultChild.getName())) {
                flags.add(ResultFlag.ID);
            }
            //解析其他节点,主要有result、association及collection
            //在这里可以说明一个result、association及collection都会被解析成一个resultMapping对象，即使他们有很多子元素
            resultMappings.add(buildResultMappingFromContext(resultChild, typeClass, flags));
        }
    }
    ResultMapResolver resultMapResolver = new ResultMapResolver(builderAssistant, id, typeClass, extend, discriminator, resultMappings, autoMapping);
    try {
        //得到resultMappings后，生成ResultMap并加入到Configuration中
        return resultMapResolver.resolve();
    } catch (IncompleteElementException  e) {
        configuration.addIncompleteResultMap(resultMapResolver);
        throw e;
    }
}
```

resultMapResolver.resolve()方法

```java
public ResultMap resolve() {
    return assistant.addResultMap(this.id, this.type, this.extend, this.discriminator, this.resultMappings, this.autoMapping);
}
```

MapperBuilderAssistant.addResultMap()方法

```java
public ResultMap addResultMap(
    String id,
    Class<?> type,
    String extend,
    Discriminator discriminator,
    List<ResultMapping> resultMappings,
    Boolean autoMapping) {
    id = applyCurrentNamespace(id, false);
    extend = applyCurrentNamespace(extend, true);
    //交由ResultMap.Builder来创建ResultMap对象，ResultMap.Builder.build()方法前面已经介绍过
    ResultMap.Builder resultMapBuilder = new ResultMap.Builder(configuration, id, type, resultMappings, autoMapping);
    if (extend != null) {
        //对继承了其他resultMap的处理，暂时不讨论
        if (!configuration.hasResultMap(extend)) {
            throw new IncompleteElementException("Could not find a parent resultmap with id '" + extend + "'");
        }
        ResultMap resultMap = configuration.getResultMap(extend);
        List<ResultMapping> extendedResultMappings = new ArrayList<ResultMapping>(resultMap.getResultMappings());
        extendedResultMappings.removeAll(resultMappings);
        // Remove parent constructor if this resultMap declares a constructor.
        boolean declaresConstructor = false;
        for (ResultMapping resultMapping : resultMappings) {
            if (resultMapping.getFlags().contains(ResultFlag.CONSTRUCTOR)) {
                declaresConstructor = true;
                break;
            }
        }
        if (declaresConstructor) {
            Iterator<ResultMapping> extendedResultMappingsIter = extendedResultMappings.iterator();
            while (extendedResultMappingsIter.hasNext()) {
                if (extendedResultMappingsIter.next().getFlags().contains(ResultFlag.CONSTRUCTOR)) {
                    extendedResultMappingsIter.remove();
                }
            }
        }
        resultMappings.addAll(extendedResultMappings);
    }
    resultMapBuilder.discriminator(discriminator);
    //生成ResultMap对象
    ResultMap resultMap = resultMapBuilder.build();
    //另到Configuration中
    configuration.addResultMap(resultMap);
    return resultMap;
}
```


经过以上分析，在得到resultMappings之后再构造ResultMap对象的过程已经完成。下面再看看ResultMapping是怎么被解析的，也就是ResultMap的直接子节点的解析。


### ResultMapping解析

constructor节点解析

```java
private void processConstructorElement(XNode resultChild, Class<?> resultType, List<ResultMapping> resultMappings) throws Exception {
    List<XNode> argChildren = resultChild.getChildren();
    //遍历子节点
    for (XNode argChild : argChildren) {
        ArrayList<ResultFlag> flags = new ArrayList<ResultFlag>();
        //标识为ResultFlag.CONSTRUCTOR
        flags.add(ResultFlag.CONSTRUCTOR);
        if ("idArg".equals(argChild.getName())) {
            //标识为一个ID属性
            flags.add(ResultFlag.ID);
        }
        //创建一个ResultMapping对象，并加入resultMappings
        //这里说明了，constructor下有多个几子节点，就会产生多少个resultMapping对象
        resultMappings.add(buildResultMappingFromContext(argChild, resultType, flags));
    }
}
```

buildResultMappingFromContext()方法生成了一个ResultMapping对象，解析如下节点都会调用这个方法来实现：

1.  constructor/idArg  

2.  constructor/arg

3.  result

4.  association

5.  collection

```java
private ResultMapping buildResultMappingFromContext(XNode context, Class<?> resultType, ArrayList<ResultFlag> flags) throws Exception {
    String property = context.getStringAttribute("property");
    String column = context.getStringAttribute("column");
    String javaType = context.getStringAttribute("javaType");
    String jdbcType = context.getStringAttribute("jdbcType");
    String nestedSelect = context.getStringAttribute("select");
    //这里需要特殊说明，一个resultMapping可以对应一个resultMap对应，我们称之为内部映射
    String nestedResultMap = context.getStringAttribute("resultMap",
                                                        processNestedResultMappings(context, Collections.<ResultMapping> emptyList()));
    String notNullColumn = context.getStringAttribute("notNullColumn");
    String columnPrefix = context.getStringAttribute("columnPrefix");
    String typeHandler = context.getStringAttribute("typeHandler");
    String resulSet = context.getStringAttribute("resultSet");
    String foreignColumn = context.getStringAttribute("foreignColumn");
    boolean lazy = "lazy".equals(context.getStringAttribute("fetchType", configuration.isLazyLoadingEnabled() ? "lazy" : "eager"));
    Class<?> javaTypeClass = resolveClass(javaType);
    Class<? extends TypeHandler<?>> typeHandlerClass = (Class<? extends TypeHandler<?>>) resolveClass(typeHandler);
    JdbcType jdbcTypeEnum = resolveJdbcType(jdbcType);
    //这里的ResultMapping生成的方法跟ResultMap生成的过程大同小异，这里不再做讨论
    return builderAssistant.buildResultMapping(resultType, property, column, javaTypeClass, jdbcTypeEnum, nestedSelect, nestedResultMap, notNullColumn, columnPrefix, typeHandlerClass, flags, resulSet, foreignColumn, lazy);
}
```


```java
//生成一个内部的ReulstMapp对象，并加到Congruation中
private String processNestedResultMappings(XNode context, List<ResultMapping> resultMappings) throws Exception {
    //只有association, collection, case节点才会生成内部映射，其他不生成，返回null
    if ("association".equals(context.getName())
        || "collection".equals(context.getName())
        || "case".equals(context.getName())) {
        if (context.getStringAttribute("select") == null) {
            //这里类似一个递归调用，需要注意内部映射的ID是Mybatis自动生成的，不是在配置文件里读取的
            ResultMap resultMap = resultMapElement(context, resultMappings);
            return resultMap.getId();
        }
    }
    return null;
}
```

再来看看内部映射的ID是怎么生成的:XMLMapperBuilder.resultMapElement方法

```java
private ResultMap resultMapElement(XNode resultMapNode, List<ResultMapping> additionalResultMappings) throws Exception {
    ErrorContext.instance().activity("processing " + resultMapNode.getValueBasedIdentifier());
    String id = resultMapNode.getStringAttribute("id",
                                                 resultMapNode.getValueBasedIdentifier());
    //getValueBasedIdentifier这就是内部映射生成ID的地方，这个只是一个标识，保证唯一性即可！这里不再讨论！
    ...
}
```

### 小结

在此，XMLMapperBuilder对配置文件中的resultMap元素的解析并生成ResultMap对象的分析基本完成。这里总结几点：

1.  ResultMap对象是结果集中的一行记录和一个java对象的对应关系。

2.  ResultMapping对象是结果集中的列与java对象的属性之间的对应关系。

3.  ResultMapp由id,type等基本的属性组成外，还包含多个ResultMapping对象。这类似于一个java对象由多个属性组成一个道理。

4.  ResultMapping最主要的属性column(结果集字段名),property(java对象的属性)，ResultMapping可以指向一个内查询或内映射。

5.  XMLMapperBuilder调用如下方法来解析并生成ResultMap对象

    ```java
    resultMapElement(XNode resultMapNode, List<ResultMapping> additionalResultMappings)
    ```

6.  在resultMapElement方法中调用

    ```java
    private ResultMapping buildResultMappingFromContext(XNode context, Class<?> resultType, ArrayList<ResultFlag> flags) 
    ```

    方法来子节点解析成ResultMapping对象。

7.  ResultMap和ResultMapping对象都是由相对应的Builder构建的。Builder只是进行了一些数据验证，并没有太多的业务逻辑。



> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
