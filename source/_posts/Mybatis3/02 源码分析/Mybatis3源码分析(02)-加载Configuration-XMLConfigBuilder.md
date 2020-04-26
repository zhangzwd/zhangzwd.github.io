---
title: MyBatis3源码之Configuration加载过程
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: configuration-loading-process-of-mybatis3-source-code
special: m3s
original: false
reproduced: true
show_title: mybatis3-configuration-loading
date: 2020-03-18 21:21:05
---

### Configuration 类在 Mybatis 中的作用

Configuration 类保存了所有 Mybatis 的配置信息。也就是说 mybaits-config.xml 及 UserMapper.xml 中所有配置信息都可以在 Configruation 对象中找到相应的信息。一般情况下 Mybatis 在运行过程中只会创建一个 Configration 对象，并且配置信息不能再被修改。如何配置 Mybatis 可以看这个文档：[http://mybatis.org/mybatis-3/zh/configuration.html](http://mybatis.org/mybatis-3/zh/configuration.html "http://mybatis.org/mybatis-3/zh/configuration.html")

### Configuration 的属性

configuration 的属性主要分为两大部分：

1.  从 mybatis-config.xml 中读取的配置
2.  从 mapper 配置文件或 Mapper 注解读取的配置

下面简单说一下这两部分的属性与配置的对应关系

#### 从 mybatis-config.xml 文件中对应的属性

```java
protected boolean safeRowBoundsEnabled = false;
protected boolean safeResultHandlerEnabled = true;
protected boolean mapUnderscoreToCamelCase = false;
protected boolean aggressiveLazyLoading = true;
protected boolean multipleResultSetsEnabled = true;
protected boolean useGeneratedKeys = false;
protected boolean useColumnLabel = true;
protected boolean cacheEnabled = true;
protected boolean callSettersOnNulls = false;
protected String logPrefix;
protected Class <? extends Log> logImpl;
protected LocalCacheScope localCacheScope = LocalCacheScope.SESSION;
protected JdbcType jdbcTypeForNull = JdbcType.OTHER;
protected Set<String> lazyLoadTriggerMethods = new HashSet<String>(Arrays.asList(new String[] { "equals", "clone", "hashCode", "toString" }));
protected Integer defaultStatementTimeout;
protected ExecutorType defaultExecutorType = ExecutorType.SIMPLE;
protected AutoMappingBehavior autoMappingBehavior = AutoMappingBehavior.PARTIAL;

protected Properties variables = new Properties();
protected ObjectFactory objectFactory = new DefaultObjectFactory();
protected ObjectWrapperFactory objectWrapperFactory = new DefaultObjectWrapperFactory();
protected MapperRegistry mapperRegistry = new MapperRegistry(this);

protected boolean lazyLoadingEnabled = false;
protected ProxyFactory proxyFactory;

protected final InterceptorChain interceptorChain = new InterceptorChain();
protected final TypeHandlerRegistry typeHandlerRegistry = new TypeHandlerRegistry();
protected final TypeAliasRegistry typeAliasRegistry = new TypeAliasRegistry();
protected final LanguageDriverRegistry languageRegistry = new LanguageDriverRegistry();
```

以上属性可以说都是由 mybatis-config.xml 文件中读取的。

例如文件中的 setting 配置
```xml
<settings>
  <setting name="cacheEnabled" value="true"/>
  <setting name="lazyLoadingEnabled" value="true"/>
  <setting name="multipleResultSetsEnabled" value="true"/>
  <setting name="useColumnLabel" value="true"/>
  <setting name="useGeneratedKeys" value="false"/>
  <setting name="autoMappingBehavior" value="PARTIAL"/>
  <setting name="defaultExecutorType" value="SIMPLE"/>
  <setting name="defaultStatementTimeout" value="25"/>
  <setting name="defaultFetchSize" value="100"/>
  <setting name="safeRowBoundsEnabled" value="false"/>
  <setting name="mapUnderscoreToCamelCase" value="false"/>
  <setting name="localCacheScope" value="SESSION"/>
  <setting name="jdbcTypeForNull" value="OTHER"/>
  <setting name="lazyLoadTriggerMethods" value="equals,clone,hashCode,toString"/>
</settings>
```
看配置的内容和 Configuration 中的属性名称，就大概知道对应关系。相信之后的解析内容了不会太复杂。

#### 从 Mapper 配置文件中读取的属性

如下属性是从 Mapper 配置文件中读取的
```java
protected final Map<String, MappedStatement> mappedStatements = new StrictMap<MappedStatement>("Mapped Statements collection");
protected final Map<String, Cache> caches = new StrictMap<Cache>("Caches collection");
protected final Map<String, ResultMap> resultMaps = new StrictMap<ResultMap>("Result Maps collection");
protected final Map<String, ParameterMap> parameterMaps = new StrictMap<ParameterMap>("Parameter Maps collection");
protected final Map<String, KeyGenerator> keyGenerators = new StrictMap<KeyGenerator>("Key Generators collection");
```
其中最主要的也是相对复杂的有如下两个(Mapper 配置文件也主要是配置这两项):

1.  mappedStatements 属性，保存了所有 Mapper 配置文件中的 select/update/insert/delete 节点信息。属性类型为一个 Map,key 为 sql 对应的 ID,MappedSatement 为一个 java 对象，保存了一个 select/update/insert/delete 的节点信息。
2.  resultMaps 属性，保存了所有 Mapper 配置文件中的 resultMap 节点。

Mapper 配置文件也主要是配置 select/update/insert/delete/resultMap 这几个节点。

### Configuration 加载过程

针对 mybatis-config.xml 配置文件和 Mapper 配置文件，Mybatis 也是由两个相对应的类来解析的。

1.  XMLConfigBuilder 解析 mybatis-config.xml 的配置到 Configuration 中
2.  XMLMapperBuilder 解析 Mapper 配置文件的配置到 Configuration 中

#### XMLConfigBuilder.parse()方法

通过 SqlSessionFactory 获取 Configuration 的代码
```java
SqlSessionFactory sqlSessionFactory=new SqlSessionFactoryBuilder().build(is);
System.out.println(sqlSessionFactory.getConfiguration());
```
再来看 SqlSessionFactoryBuilder.build()方法：
```java
public SqlSessionFactory build(InputStream inputStream) {
	return build(inputStream, null, null);
}

public SqlSessionFactory build(InputStream inputStream, String environment) {
	return build(inputStream, environment, null);
}

public SqlSessionFactory build(InputStream inputStream, Properties properties) {
	return build(inputStream, null, properties);
}

public SqlSessionFactory build(InputStream inputStream, String environment, Properties properties) {
	try {
		XMLConfigBuilder parser = new XMLConfigBuilder(inputStream, environment, properties);
		//从这里可以看出XMLConfigBuilder.parse()返回了一个Configuration对象
		return build(parser.parse());
	} catch (Exception e) {
		throw ExceptionFactory.wrapException("Error building SqlSession.", e);
	} finally {
		ErrorContext.instance().reset();
		try {
			inputStream.close();
		} catch (IOException e) {
			// Intentionally ignore. Prefer previous error.
		}
	}
}

public SqlSessionFactory build(Configuration config) {
	return new DefaultSqlSessionFactory(config);
}
```
加载具体配置
```java
public Configuration parse() {
  if (parsed) {
    throw new BuilderException("Each XMLConfigBuilder can only be used once.");
  }
  parsed = true;
  parseConfiguration(parser.evalNode("/configuration"));
  return configuration;
}

//从xml配置文件中加载到Configuration对象中
private void parseConfiguration(XNode root) {
  try {
    //加载properties节点,一般是定义一些变量
    propertiesElement(root.evalNode("properties")); //issue #117 read properties first
    //加载别名
    typeAliasesElement(root.evalNode("typeAliases"));
    //拦截器
    pluginElement(root.evalNode("plugins"));
    objectFactoryElement(root.evalNode("objectFactory"));
    objectWrapperFactoryElement(root.evalNode("objectWrapperFactory"));

    settingsElement(root.evalNode("settings"));
    environmentsElement(root.evalNode("environments")); // read it after objectFactory and objectWrapperFactory issue #631
    databaseIdProviderElement(root.evalNode("databaseIdProvider"));

    //加载Mapper的配置文件，最主要的有两个：一个是sql的定义，一个是resultMap
    typeHandlerElement(root.evalNode("typeHandlers"));
    mapperElement(root.evalNode("mappers"));
  } catch (Exception e) {
    throw new BuilderException("Error parsing SQL Mapper Configuration. Cause: " + e, e);
  }
}
```
#### 加载 properties 节点
```java
private void propertiesElement(XNode context) throws Exception {
  if (context != null) {
    //先加载property子节点下的属性
    Properties defaults = context.getChildrenAsProperties();
    String resource = context.getStringAttribute("resource");
    String url = context.getStringAttribute("url");
    //不能同时设置resource属性和url属性
    if (resource != null && url != null) {
      throw new BuilderException("The properties element cannot specify both a URL and a resource based property file reference.  Please specify one or the other.");
    }
    if (resource != null) {
      //会覆盖子节点的配置
      defaults.putAll(Resources.getResourceAsProperties(resource));
    } else if (url != null) {
      //会覆盖子节点的配置
      defaults.putAll(Resources.getUrlAsProperties(url));
    }
    Properties vars = configuration.getVariables();
    if (vars != null) {
      defaults.putAll(vars);
    }
    parser.setVariables(defaults);
    //设置了变量列表中去
    configuration.setVariables(defaults);
  }
}
```
从这个方法中可以看出配置规则

1.  可以设置 url 或 resource 属性从外部文件中加载一个 properties 文件

2.  可以通过 property 子节点进行配置，如果子节点属性的 key 与外部文件的 key 重复的话，子节点的将被覆

3.  通过编程方式定义的属性最后加载，优先级最高：

    ```java
    public SqlSessionFactory build(InputStream inputStream, Properties properties)
    ```

properties 配置示例

```xml
<properties resource="org/mybatis/example/config.properties">
  <property name="username" value="dev_user"/>
  <property name="password" value="F2Fa3!33TYyg"/>
</properties>
```

这里加载的主要是给后面的配置作为变量使用!

## 加载别名
```java
private void typeAliasesElement(XNode parent) {
  if (parent != null) {
    for (XNode child : parent.getChildren()) {
      if ("package".equals(child.getName())) {
        //package的方式，很少用到，略过
        String typeAliasPackage = child.getStringAttribute("name");
        configuration.getTypeAliasRegistry().registerAliases(typeAliasPackage);
      } else {
        String alias = child.getStringAttribute("alias");
        String type = child.getStringAttribute("type");
        try {
          Class<?> clazz = Resources.classForName(type);
          if (alias == null) {
            typeAliasRegistry.registerAlias(clazz);
          } else {
            //加载到别名注册表中
            typeAliasRegistry.registerAlias(alias, clazz);
          }
        } catch (ClassNotFoundException e) {
          throw new BuilderException("Error registering typeAlias for '" + alias + "'. Cause: " + e, e);
        }
      }
    }
  }
}
```
再看 TypeAliasRegistry 源码，发现 mybatis 已经为定义了很多别名，方便以后的配置
```java
public TypeAliasRegistry() {
    registerAlias("string", String.class);

    registerAlias("byte", Byte.class);
    registerAlias("long", Long.class);
    registerAlias("short", Short.class);
    registerAlias("int", Integer.class);
    registerAlias("integer", Integer.class);
    registerAlias("double", Double.class);
    registerAlias("float", Float.class);
    registerAlias("boolean", Boolean.class);

    registerAlias("byte[]", Byte[].class);
    registerAlias("long[]", Long[].class);
    registerAlias("short[]", Short[].class);
    registerAlias("int[]", Integer[].class);
    registerAlias("integer[]", Integer[].class);
    registerAlias("double[]", Double[].class);
    registerAlias("float[]", Float[].class);
    registerAlias("boolean[]", Boolean[].class);

    registerAlias("_byte", byte.class);
    registerAlias("_long", long.class);
    registerAlias("_short", short.class);
    registerAlias("_int", int.class);
    registerAlias("_integer", int.class);
    registerAlias("_double", double.class);
    registerAlias("_float", float.class);
    registerAlias("_boolean", boolean.class);

    registerAlias("_byte[]", byte[].class);
    registerAlias("_long[]", long[].class);
    registerAlias("_short[]", short[].class);
    registerAlias("_int[]", int[].class);
    registerAlias("_integer[]", int[].class);
    registerAlias("_double[]", double[].class);
    registerAlias("_float[]", float[].class);
    registerAlias("_boolean[]", boolean[].class);

    registerAlias("date", Date.class);
    registerAlias("decimal", BigDecimal.class);
    registerAlias("bigdecimal", BigDecimal.class);
    registerAlias("biginteger", BigInteger.class);
    registerAlias("object", Object.class);

    registerAlias("date[]", Date[].class);
    registerAlias("decimal[]", BigDecimal[].class);
    registerAlias("bigdecimal[]", BigDecimal[].class);
    registerAlias("biginteger[]", BigInteger[].class);
    registerAlias("object[]", Object[].class);

    registerAlias("map", Map.class);
    registerAlias("hashmap", HashMap.class);
    registerAlias("list", List.class);
    registerAlias("arraylist", ArrayList.class);
    registerAlias("collection", Collection.class);
    registerAlias("iterator", Iterator.class);

    registerAlias("ResultSet", ResultSet.class);
}
```
还有一个加载通过别名加载 class 的方法
```java
public <T> Class<T> resolveAlias(String string) {
  try {
    if (string == null) return null;
    String key = string.toLowerCase(Locale.ENGLISH); // issue #748
    Class<T> value;
    if (TYPE_ALIASES.containsKey(key)) {
      //如果是别名，直接从注册表里返回
      value = (Class<T>) TYPE_ALIASES.get(key);
    } else {
      value = (Class<T>) Resources.classForName(string);
    }
    return value;
  } catch (ClassNotFoundException e) {
    throw new TypeException("Could not resolve type alias '" + string + "'.  Cause: " + e, e);
  }
}
```
#### 加载 Mapper 配置文件
```java
private void mapperElement(XNode parent) throws Exception {
  if (parent != null) {
    for (XNode child : parent.getChildren()) {
      if ("package".equals(child.getName())) {
        String mapperPackage = child.getStringAttribute("name");
        configuration.addMappers(mapperPackage);
      } else {
        String resource = child.getStringAttribute("resource");
        String url = child.getStringAttribute("url");
        String mapperClass = child.getStringAttribute("class");
        if (resource != null && url == null && mapperClass == null) {
          ErrorContext.instance().resource(resource);
          InputStream inputStream = Resources.getResourceAsStream(resource);
          //由XMLMapperBuilder对象解析加载
          XMLMapperBuilder mapperParser = new XMLMapperBuilder(inputStream, configuration, resource, configuration.getSqlFragments());
          mapperParser.parse();
        } else if (resource == null && url != null && mapperClass == null) {
          ErrorContext.instance().resource(url);
          InputStream inputStream = Resources.getUrlAsStream(url);
          //由XMLMapperBuilder对象解析加载
          XMLMapperBuilder mapperParser = new XMLMapperBuilder(inputStream, configuration, url, configuration.getSqlFragments());
          mapperParser.parse();
        } else if (resource == null && url == null && mapperClass != null) {
          Class<?> mapperInterface = Resources.classForName(mapperClass);
          configuration.addMapper(mapperInterface);
        } else {
          throw new BuilderException("A mapper element may only specify a url, resource or class, but not more than one.");
        }
      }
    }
  }
}
```
一个 Mapper 的配置文件最终会由 XMLMapperBuilder 对象解析加载到 Configuration 对象中。XMLMapperBuilder 的解析过程中 XMLConfigBuilder 解析过程差不多，以后再详细分析！

#### 加载其他配置项

还有一些配置项这里没有讲到，如：插件/拦截器、对象工厂、setting 项。这些的加载都比较简单，只要花点心里就可以看明白。在以后分析代码过程中，一定会看到这里配置，到时再进一步研究，不过可以肯定这里配置很多情况下都是使用默认的值。

> 作者：ashan_li
> 链接：http://suo.im/69lahT
