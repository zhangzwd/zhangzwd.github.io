---
title: MyBatis3源码之MappedStatement加载过程
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-xmlmappbuilder-loading-resultmap-process
special: m3s
original: false
reproduced: true
date: 2021-05-10 22:12:16
show_title: mybatis3-source-code-mappedStatement
---

MappedStatement说明
=================

一个MappedStatement对象对应Mapper配置文件中的一个select/update/insert/delete节点，主要描述的是一条SQL语句。其属性有


      //节点中的id属性加要命名空间
      private String id;
      //直接从节点属性中取
      private Integer fetchSize;
      //直接从节点属性中取
      private Integer timeout;
      private StatementType statementType;
      private ResultSetType resultSetType;
      //对应一条SQL语句
      private SqlSource sqlSource;
    
      //每条语句都对就一个缓存，如果有的话。
      private Cache cache;
      //这个已经过时了
      private ParameterMap parameterMap;
      private List<ResultMap> resultMaps;
      private boolean flushCacheRequired;
      private boolean useCache;
      private boolean resultOrdered;
      //SQL的类型,select/update/insert/detete
      private SqlCommandType sqlCommandType;
      private KeyGenerator keyGenerator;
      private String[] keyProperties;
      private String[] keyColumns;
      
      //是否有内映射
      private boolean hasNestedResultMaps;
      private String databaseId;
      private Log statementLog;
      private LanguageDriver lang;
      private String[] resultSets;

  

上面属性都比较简单，复杂的是SqlSource,下面有详细的描述！

  

XMLStatementBuilder.parseStatementNode()方法
==========================================

resultMap元素的解析已经分析完毕。与resultMap不一样，XmlMapperBuilder在解析select/update/insert/delete的元素时会创建一个XMLStatementBuilder对象，解析的工作交由其方法parseStatementNode()方法完成。

    private void buildStatementFromContext(List<XNode> list, String requiredDatabaseId) {
        for (XNode context : list) {
          //一个select/update/insert/delete元素创建一个XMLStatementBuilder对象
          final XMLStatementBuilder statementParser = new XMLStatementBuilder(configuration, builderAssistant, context, requiredDatabaseId);
          try {
            //将元素解析成MappedStatemenet对象，并加入到Configuration中去
            statementParser.parseStatementNode();
          } catch (IncompleteElementException e) {
            configuration.addIncompleteStatement(statementParser);
          }
        }

如下是parseStatementNode()方法的代码

```java
public void parseStatementNode() {
    String id = context.getStringAttribute("id");
    String databaseId = context.getStringAttribute("databaseId");

    if (!databaseIdMatchesCurrent(id, databaseId, this.requiredDatabaseId)) return;

    Integer fetchSize = context.getIntAttribute("fetchSize");
    Integer timeout = context.getIntAttribute("timeout");
    String parameterMap = context.getStringAttribute("parameterMap");
    String parameterType = context.getStringAttribute("parameterType");
    Class<?> parameterTypeClass = resolveClass(parameterType);
    String resultMap = context.getStringAttribute("resultMap");
    String resultType = context.getStringAttribute("resultType");
    String lang = context.getStringAttribute("lang");
    LanguageDriver langDriver = getLanguageDriver(lang);

    Class<?> resultTypeClass = resolveClass(resultType);
    String resultSetType = context.getStringAttribute("resultSetType");
    //Statement的类型，对应jdbc里的三个类型:Statement、PreparedStatement、CallableStatement，默认使用PreparedStatement
    StatementType statementType = StatementType.valueOf(context.getStringAttribute("statementType", StatementType.PREPARED.toString()));
    //这个也是跟jdbc里相对应的，一般采用默认即可
    ResultSetType resultSetTypeEnum = resolveResultSetType(resultSetType);
   
    //Sql的类型，select/update/insert/delete
    String nodeName = context.getNode().getNodeName();
    SqlCommandType sqlCommandType = SqlCommandType.valueOf(nodeName.toUpperCase(Locale.ENGLISH));
    boolean isSelect = sqlCommandType == SqlCommandType.SELECT;
    //是否刷新缓存
    boolean flushCache = context.getBooleanAttribute("flushCache", !isSelect);
    //是否使用缓存
    boolean useCache = context.getBooleanAttribute("useCache", isSelect);
    boolean resultOrdered = context.getBooleanAttribute("resultOrdered", false);

    //不做分析
    // Include Fragments before parsing
    XMLIncludeTransformer includeParser = new XMLIncludeTransformer(configuration, builderAssistant);
    includeParser.applyIncludes(context.getNode());
    //不做分析
    // Parse selectKey after includes and remove them.
    processSelectKeyNodes(id, parameterTypeClass, langDriver);
    
    //生成SqlSource对象，这个对象非常重要，接下来详细分析
    // Parse the SQL (pre: <selectKey> and <include> were parsed and removed)
    SqlSource sqlSource = langDriver.createSqlSource(configuration, context, parameterTypeClass);
    String resultSets = context.getStringAttribute("resultSets");
    String keyProperty = context.getStringAttribute("keyProperty");
    String keyColumn = context.getStringAttribute("keyColumn");
    
    //自动生成key，这里也不做讨论
    KeyGenerator keyGenerator;
    String keyStatementId = id + SelectKeyGenerator.SELECT_KEY_SUFFIX;
    keyStatementId = builderAssistant.applyCurrentNamespace(keyStatementId, true);
    if (configuration.hasKeyGenerator(keyStatementId)) {
      keyGenerator = configuration.getKeyGenerator(keyStatementId);
    } else {
      keyGenerator = context.getBooleanAttribute("useGeneratedKeys",
          configuration.isUseGeneratedKeys() && SqlCommandType.INSERT.equals(sqlCommandType))
          ? new Jdbc3KeyGenerator() : new NoKeyGenerator();
    }
    //生成MappedStatement对象，并加到Configuration中
    builderAssistant.addMappedStatement(id, sqlSource, statementType, sqlCommandType,
        fetchSize, timeout, parameterMap, parameterTypeClass, resultMap, resultTypeClass,
        resultSetTypeEnum, flushCache, useCache, resultOrdered, 
        keyGenerator, keyProperty, keyColumn, databaseId, langDriver, resultSets);
  }
```

上在方法里附件解析一些基本的属性外还有两个主要的部分

1.  SqlSource的构建过程  
    
    ```java
     SqlSource sqlSource = langDriver.createSqlSource(configuration, context, parameterTypeClass);
    ```
    
2.  MappedStatement的构建过程
    
    ```java
     builderAssistant.addMappedStatement(id, sqlSource, statementType, sqlCommandType,
            fetchSize, timeout, parameterMap, parameterTypeClass, resultMap, resultTypeClass,
            resultSetTypeEnum, flushCache, useCache, resultOrdered, 
            keyGenerator, keyProperty, keyColumn, databaseId, langDriver, resultSets);
    ```

SqlSource构建过程
=============

SqlSource接口
-----------

```java
/**
 * Represents the content of a mapped statement read from an XML file or an annotation. 
 * It creates the SQL that will be passed to the database out of the input parameter received from the user.
 *
 * @author Clinton Begin
 */
public interface SqlSource {

  BoundSql getBoundSql(Object parameterObject);

}
```

SqlSource表示从mapper.xml或注解中读取的sql内容,该sql一般还不能都被直接执行,例如

```xml
<select id="selectUserDetail" resultMap="detailUserResultMap">
	<!--CDATA里内容会都解析成一个SqlSource对象-->
    <![CDATA[
	    select user_id,user_name,user_type,cust_id from tf_f_user a where a.user_id=#${userId}
	]]>
</select>
```

SqlSource只有一个方法:getBoundSql(paramenterObject),其中paramenterObject为运行sql里的实际参数

BoundSql
--------

```java
/**
 * An actual SQL String got form an {@link SqlSource} after having processed any dynamic content.
 * The SQL may have SQL placeholders "?" and an list (ordered) of an parameter mappings 
 * with the additional information for each parameter (at least the property name of the input object to read 
 * the value from). 
 * </br>
 * Can also have additional parameters that are created by the dynamic language (for loops, bind...).
 */
/**
 * @author Clinton Begin
 */
public class BoundSql {

  private String sql;
  private List<ParameterMapping> parameterMappings;
  private Object parameterObject;
  private Map<String, Object> additionalParameters;
  private MetaObject metaParameters;

  public BoundSql(Configuration configuration, String sql, List<ParameterMapping> parameterMappings, Object parameterObject) {
    this.sql = sql;
    this.parameterMappings = parameterMappings;
    this.parameterObject = parameterObject;
    this.additionalParameters = new HashMap<String, Object>();
    this.metaParameters = configuration.newMetaObject(additionalParameters);
  }

  public String getSql() {
    return sql;
  }

  public List<ParameterMapping> getParameterMappings() {
    return parameterMappings;
  }

  public Object getParameterObject() {
    return parameterObject;
  }

  public boolean hasAdditionalParameter(String name) {
    return metaParameters.hasGetter(name);
  }

  public void setAdditionalParameter(String name, Object value) {
    metaParameters.setValue(name, value);
  } 

  public Object getAdditionalParameter(String name) {
    return metaParameters.getValue(name); 
  }
}
```


SqlBound代码并不多，就是一个普通的java对象，有两个属性非常重要

1.  sql:看代码里的注解，这个sql已经是经过了一些处理，可以被jdbc执行的了。xml里配置的sql可能有占位符#{username},这里的sql占位符已经被替换成"?"号了。
2.  parameterMappings:执行sql对象的实际的参数。由此可以判断，每执行一条sql都会创建一个BoundSql对象。

SqlSource和BoundSql本身并不复杂，复杂的是这两个对象被创建的过程。

LanguageDriver
--------------

SqlSource对象是通过LanguageDriver对象构建的，在mapper.xml配置sql里可以通过lang属性指定一个LanguageDriver，但我们通常不会这样子做。当lang属性没有配置时，Mybatis会属性默认给一个。这个默认的LanguageDriver在Configuration的构造方法中定义的:

```java
public Configuration() {
    ...
    languageRegistry.setDefaultDriverClass(XMLLanguageDriver.class);
    languageRegistry.register(RawLanguageDriver.class);
  }
```




马上来看XMLLanguageDriver.createSqlSource()方法

```java
public SqlSource createSqlSource(Configuration configuration, XNode script, Class<?> parameterType) {
    XMLScriptBuilder builder = new XMLScriptBuilder(configuration, script, parameterType);
    return builder.parseScriptNode();
  }
```

XMLScriptBuilder  

-------------------

XMLScriptBuilder.parseScriptNode()方法

```java
public SqlSource parseScriptNode() {
    //将一个sql内容解析成多个SqlNode
    List<SqlNode> contents = parseDynamicTags(context);
    //将多个SqlNode组合一个SqlNode
    MixedSqlNode rootSqlNode = new MixedSqlNode(contents);
    SqlSource sqlSource = null;
    //判断sql是否是动态的
    if (isDynamic) {
      //生成动态的SqlSource
      sqlSource = new DynamicSqlSource(configuration, rootSqlNode);
    } else {
      //生成静态的SqlSource
      sqlSource = new RawSqlSource(configuration, rootSqlNode, parameterType);
    }
    return sqlSource;
  }
```

  

再看parseDynamicTagS(context)方法

```java
private List<SqlNode> parseDynamicTags(XNode node) {
    //一个sql会被解析成多个SqlNode，稍后会有示例详细说明
    List<SqlNode> contents = new ArrayList<SqlNode>();
    NodeList children = node.getNode().getChildNodes();
    for (int i = 0; i < children.getLength(); i++) {
      XNode child = node.newXNode(children.item(i));
      if (child.getNode().getNodeType() == Node.CDATA_SECTION_NODE || child.getNode().getNodeType() == Node.TEXT_NODE) {
        //如果这个Node只包含文本
        String data = child.getStringBody("");
        //生成一个TextSqlNode
        TextSqlNode textSqlNode = new TextSqlNode(data);
        //判断是否是动态的,如果文本里包含占位符，如#{username}或{table_name},isDynamic()方法就会返回true
        if (textSqlNode.isDynamic()) {
          contents.add(textSqlNode);
          isDynamic = true;
        } else {
          contents.add(new StaticTextSqlNode(data));
        }
      } else if (child.getNode().getNodeType() == Node.ELEMENT_NODE) { // issue #628
        //如果是有xml标签的Node,交由Handler处理，同时被认为是动态的
        String nodeName = child.getNode().getNodeName();
        NodeHandler handler = nodeHandlers.get(nodeName);
        if (handler == null) {
          throw new BuilderException("Unknown element <" + nodeName + "> in SQL statement.");
        }
        handler.handleNode(child, contents);
    
        isDynamic = true;
      }
    }
    return contents;
  }
```

  

再看看nodeHandlers都有那些

```java
private Map<String, NodeHandler> nodeHandlers = new HashMap<String, NodeHandler>() {
    private static final long serialVersionUID = 7123056019193266281L;

    {
      //Mybatis3动态sql都支持那些配置，这里就很清楚啦
      put("trim", new TrimHandler());
      put("where", new WhereHandler());
      put("set", new SetHandler());
      put("foreach", new ForEachHandler());
      put("if", new IfHandler());
      put("choose", new ChooseHandler());
      put("when", new IfHandler());
      put("otherwise", new OtherwiseHandler());
      put("bind", new BindHandler());
    }
  };
```

  

看到这里基本上能了解sql是怎么被解析的啦！举例说明:

```xml
<select id="selectUserDetail" resultMap="detailUserResultMap">
		<![CDATA[
			select user_id,user_name,user_type,cust_id --这里一行会解析成一个StaticTextSqlNode
				from tf_f_user a --这里一行也会解析成一个StaticTextSqlNode
				where a.user_id=#{userId} --这行会被解析成TextSqlNode,并且isDynamic被设置成true,因为有占位符
				                          --这个空行也解析成一个StaticTextSqlNode
		]]><!-- 这四个SqlNode会被组合成一个MixedSqlNode -->
	</select>
```

  

再来个动态sql的:

```xml
<select id="selectUserDetail" resultMap="detailUserResultMap">
		<![CDATA[
			select user_id,user_name,user_type,cust_id --这里一行会解析成一个StaticTextSqlNode
				from tf_f_user a --这里一行也会解析成一个StaticTextSqlNode
				where a.user_id=#{userId} --这行会被解析成TextSqlNode,并且isDynamic被设置成true,因为有占位符
				                          --这个空行也解析成一个StaticTextSqlNode
		]]>
		<if test="user_name!=null"> <!-- 这个标签里的内容会交给IfHandler处理 -->
			and --这里的解析与上行的一样，解析成一个StaticTextSqlNode
			user_name=#{userName} --这里的解析与上行的一样，也会被解析成一个TextSqlNode,并且isDynamic被设置成true,因为有占位符
		</if><!-- IfHandler会将这里面的内个SqlNode组成MixedSqlNode再组成一个IfSqlNode -->
	</select><!-- 这五个SqlNode会被组合成一个MixedSqlNode -->
```

  

附上IfHandler的代码

```java
private class IfHandler implements NodeHandler {
    public void handleNode(XNode nodeToHandle, List<SqlNode> targetContents) {
      //解析子节点
      List<SqlNode> contents = parseDynamicTags(nodeToHandle);
      //组合
      MixedSqlNode mixedSqlNode = new MixedSqlNode(contents);
      String test = nodeToHandle.getStringAttribute("test");
      //生成IfSqlNode
      IfSqlNode ifSqlNode = new IfSqlNode(mixedSqlNode, test);
      targetContents.add(ifSqlNode);
    }
  }
```

  

其他的nodeHandler在这里就不讨论了，实现方式与IfHandler差不多。如下两个方法也不在这里做讨论

1.  SqlSource.getBoundSql()方法
2.  SqlNode.apply(DynamicContextcontext)方法

因为这两个方法都是在sql被执行时才调用。在后续的SqlSession实现章节再讨论！

> 作者：ashan_li
> 链接：http://suo.im/5G73Rn
