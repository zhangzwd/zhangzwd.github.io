---
title: MyBatis3源码之ResultMap加载过程
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: loading-process-of-resultmap-of-mybatis3-source-code
special: m3s
original: false
reproduced: true
date: 2020-03-21 08:55:06
show_title: mybatis3-resultmap-loading
---


### XMLMapperBuilder简单说明  

XMLMapperBuildery主要是加载mapper配置文件加Configuration中。主要加载两大内容  

1.  ResultMap:结果集映射，对应Configuration中的resultMaps属性
    
    ```java
    protected final Map<String, ResultMap> resultMaps = new StrictMap<ResultMap>("Result Maps collection");
    ```
    
2.  sql:即mapper配置文件中的select、update、insert、delete节点。对应Configuration中的mappedStatements
    
    ```java
    protected final Map<String, MappedStatement> mappedStatements = new StrictMap<MappedStatement>("Mapped Statements collection");
    ```
    

### Configuration内部类StrictMap分析
StrictMap继承了HashMap<String,T>主要增加了如下三点:

1.  多了一个名字，然而并没有什么用处
    
    ```java
    public StrictMap(String name) {
        super();
        this.name = name;
    }
    ```
2.  重写了put方法
    
    ```java
    public V put(String key, V value) {
      if (containsKey(key))
        //如果已经存在key，抛出异常
        throw new IllegalArgumentException(name + " already contains value for " + key);
      if (key.contains(".")) {//key中是否存在"."
        //getShortName()方法获取了最后一个"."之后的字符，如:key=com.ashan.Hello,那么shortName=Hello
        final String shortKey = getShortName(key);
        //再判断shortKey是否已经存在了
        if (super.get(shortKey) == null) {
          //如果不存在，直接设置
          super.put(shortKey, value);
        } else {
          //如果已经存在，设置为一个特殊的对象，标识shortName同时对应的了多个值
          super.put(shortKey, (V) new Ambiguity(shortKey));
        }
      }
      return super.put(key, value);
    }
    ```
    这个put方法主要逻辑：
    
    1.  如果key已经存在，将直接报错
    2.  如果key还未存在，直接设置
    3.  如果key中包含了"."符号，截取最后一个"."符号后面的字符串做为shortName
    4.  如果shortName之前已经存在，将shortName对应的值设置为一个特殊对名，get方法如果获取一个特殊对象里将报错
    5.  如果shortName未存在，将shortName对应的值设置成与key对应的值一样
    
    例如：调用了
    
    ```java
    put(com.ashan.selectUserById,"select * from tab_user where id=?")
    ```
    
    map里将这样保存数据(两key对应同一个value)
    
    ```java
    com.ashan.selectUserById="select * from tab_user where id=?"
              selectUserById="select * from tab_user where id=?"
    ```
    
3.  重写了get方法
    
    ```java 
    public V get(Object key) {
      V value = super.get(key);
      if (value == null) {
        throw new IllegalArgumentException(name + " does not contain value for " + key);
      }
      if (value instanceof Ambiguity) {
    //如果为特殊对象Ambiguity，同一个shortName有多个命名空间使用，所有不允许用shortName方法，必须加上命名空间访问
        throw new IllegalArgumentException(((Ambiguity) value).getSubject() + " is ambiguous in " + name
                                           + " (try using the full name including the namespace, or rename one of the entries)");
      }
      return value;
    }
    ```
    
    StrictMap只是增加了对命名空间的支持，并没有太多的逻辑！

### ResultMap类
mapper配置文件中的resultMap节点最终会被解析成一个ResultMap对象，这个对象中包含多个ResultMapping对象，我们可以这样子认为，ResultMap为一个java对象和一个结果集/表中的一行记录对应，ResultMapping为一个java对象中的属性和一个结果集/表某一行的某一个字段对应。如下示例:

```xml
<resultMap type="com.ashan.mybatis.User" id="detailUserResultMap"><!-- 整个resultMap会被解析成一个ResultMap对应 -->
	<constructor>
		<idArg column="user_id" javaType="String"/><!-- idArg会被解析成一个resultMapping对象 -->
		<arg column="user_name"/><!-- resultMapping对象 -->
	</constructor>
	
	<result property="password" column="user_pwd" /><!-- resultMapping对象 -->
	<result property="type" column="user_type" javaType="com.ashan.mybatis.UserType" <!-- resultMapping对象 -->
	       typeHandler="com.ashan.mybatis.UserTypeHandler"/>
	<result property="svcnum" column="svc_num" /> <!-- resultMapping对象 -->
	
	<association property="cust" javaType="com.ashan.mybatis.Cust"> <!-- resultMapping对象 这个resultMapping对象指向了另一个ResultMap-->
		<id property="id" column="cust_id"/>
		<result property="custname" column="cust_name"/>
		<result property="certNo" column="cert_no"/>
	</association>
	
	<collection property="accts" ofType="com.ashan.mybatis.Acct">
		<id property="id" column="acct_id" />
		<result property="payName" column="pay_name"/>
		<result property="bankNo" column="bank_no"/>
	</collection>

</resultMap>
```

ResultMap的主要属性


```java
//id="detailUserResultMap"
private String id;
//type="com.ashan.mybatis.User"
private Class<?> type;
//所有的resultMapping对象，包括constructor/idArg,constructor/arg,result,association,collection,但不包括association和collection里的子节点
//上图中应该有7个
private List<ResultMapping> resultMappings;
//包括constructor/idArg,id
private List<ResultMapping> idResultMappings;
//constructor里的子节点
private List<ResultMapping> constructorResultMappings;
//除constructor里的子节点,其他都是，result,association,collection,id
private List<ResultMapping> propertyResultMappings;
//所有被映射的列
private Set<String> mappedColumns;
//比较少用
private Discriminator discriminator;
//是否有内映射，上图中association, collection都为内映射,内查询不算（就是的reulst节点中配置select属性的情况）
private boolean hasNestedResultMaps;
//是否有查询，
private boolean hasNestedQueries;
//是否要求自动映射
private Boolean autoMapping;
```

ResultMap.Builder.build()方法

```java
public ResultMap build() {
  if (resultMap.id == null) {
    throw new IllegalArgumentException("ResultMaps must have an id");
  }
  resultMap.mappedColumns = new HashSet<String>();
  resultMap.idResultMappings = new ArrayList<ResultMapping>();
  resultMap.constructorResultMappings = new ArrayList<ResultMapping>();
  resultMap.propertyResultMappings = new ArrayList<ResultMapping>();
  //遍历所有的resultMapping
  for (ResultMapping resultMapping : resultMap.resultMappings) {
    //如果其中一个resultMapping有内查询，则这个resultMap也就是有内查询
    resultMap.hasNestedQueries = resultMap.hasNestedQueries || resultMapping.getNestedQueryId() != null;
    //如果其中一个resultMapping有内映射，则这个resultMap也就是有内映射
    resultMap.hasNestedResultMaps = resultMap.hasNestedResultMaps || (resultMapping.getNestedResultMapId() != null && resultMapping.getResultSet() == null);
    final String column = resultMapping.getColumn();
    if (column != null) {
      resultMap.mappedColumns.add(column.toUpperCase(Locale.ENGLISH));
    } else if (resultMapping.isCompositeResult()) {
      //组合的配置
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
```
### ResultMapping主要属性


```java
private Configuration configuration;
//java对象的属性名
private String property;
//结果集中的字段名
private String column;
//属性类型
private Class<?> javaType;

private JdbcType jdbcType;
private TypeHandler<?> typeHandler;

//内部映射的ResultMapId
private String nestedResultMapId;
//内查询ID
private String nestedQueryId;
private Set<String> notNullColumns;
private String columnPrefix;
private List<ResultFlag> flags;
private List<ResultMapping> composites;
private String resultSet;
private String foreignColumn;
private boolean lazy;
```

这个类就是一个普通的java对象，本身没有什么逻辑，要想知道属性是怎么产生的,还得分析XMLMapperBuildery的源代码。

> 作者：ashan_li
> 链接：http://suo.im/6gRndy
