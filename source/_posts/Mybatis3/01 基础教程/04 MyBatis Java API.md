---
title: MyBatis Java API
tags:
  - Java
  - MyBatis
  - MyBatis基础教程
copyright: true
categories:
  - MyBatis基础教程
translate_title: mybatis-java-api
special: m3
show_title: mybatis-java-api
date: 2019-10-15 21:58:57
---


Java API
--------

既然你已经知道如何配置 MyBatis 和创建映射文件,你就已经准备好来提升技能了。 MyBatis 的 Java API 就是你收获你所做的努力的地方。正如你即将看到的,和 JDBC 相比, MyBatis 很大程度简化了你的代码而且保持简洁,很容易理解和维护。MyBatis 3 已经引入 了很多重要的改进来使得 SQL 映射更加优秀。

应用目录结构
------

在我们深入 Java API 之前,理解关于目录结构的最佳实践是很重要的。MyBatis 非常灵 活, 你可以用你自己的文件来做几乎所有的事情。 但是对于任一框架, 都有一些最佳的方式。

让我们看一下典型应用的目录结构:

```
/my_application
  /bin
  /devlib
  /lib                <-- MyBatis *.jar文件在这里。
  /src
    /org/myapp/
      /action
      /data           <-- MyBatis配置文件在这里, 包括映射器类, XML配置, XML映射文件。
        /mybatis-config.xml
        /BlogMapper.java
        /BlogMapper.xml
      /model
      /service
      /view
    /properties       <-- 在你XML中配置的属性 文件在这里。
  /test
    /org/myapp/
      /action
      /data
      /model
      /service
      /view
    /properties
  /web
    /WEB-INF
      /web.xml
```

Remember, these are preferences, not requirements, but others will thank you for using a common directory structure.

这部分内容剩余的示例将假设你使用了这种目录结构。

SqlSessions
-----------

使用 MyBatis 的主要 Java 接口就是 SqlSession。尽管你可以使用这个接口执行命令,获 取映射器和管理事务。我们会讨论 SqlSession 本身更多,但是首先我们还是要了解如果获取 一个 SqlSession 实例。SqlSessions 是由 SqlSessionFactory 实例创建的。SqlSessionFactory 对 象 包 含 创 建 SqlSession 实 例 的 所 有 方 法 。 而 SqlSessionFactory 本 身 是 由 SqlSessionFactoryBuilder 创建的,它可以从 XML 配置,注解或手动配置 Java 来创建 SqlSessionFactory。

NOTE When using MyBatis with a dependency injection framework like Spring or Guice, SqlSessions are created and injected by the DI framework so you don't need to use the SqlSessionFactoryBuilder or SqlSessionFactory and can go directly to the SqlSession section. Please refer to the MyBatis-Spring or MyBatis-Guice manuals for further info.

#### SqlSessionFactoryBuilder

SqlSessionFactoryBuilder 有五个 build()方法,每一种都允许你从不同的资源中创建一个 SqlSession 实例。

```Java
    SqlSessionFactory build(InputStream inputStream)
    SqlSessionFactory build(InputStream inputStream, String environment)
    SqlSessionFactory build(InputStream inputStream, Properties properties)
    SqlSessionFactory build(InputStream inputStream, String env, Properties props)
    SqlSessionFactory build(Configuration config)
```

第一种方法是最常用的,它使用了一个参照了 XML 文档或上面讨论过的更特定的 mybatis-config.xml 文件的 Reader 实例。 可选的参数是 environment 和 properties。 Environment 决定加载哪种环境,包括数据源和事务管理器。比如:

```xml
<environments default="development">
  <environment id="development">
    <transactionManager type="JDBC">
        ...
    <dataSource type="POOLED">
        ...
  </environment>
  <environment id="production">
    <transactionManager type="MANAGED">
        ...
    <dataSource type="JNDI">
        ...
  </environment>
</environments>
```

如果你调用了 一个使用 environment 参数 方 式的 build 方法, 那么 MyBatis 将会使用 configuration 对象来配置这个 environment。 当然, 如果你指定了一个不合法的 environment, 你会得到错误提示。 如果你调用了其中之一没有 environment 参数的 build 方法, 那么就使用 默认的 environment(在上面的示例中就会指定为 default="development")。

如果你调用了使用 properties 实例的方法,那么 MyBatis 就会加载那些 properties(属性 配置文件) ,并你在你配置中可使用它们。那些属性可以用${propName}语法形式多次用在 配置文件中。

回想一下,属性可以从 mybatis-config.xml 中被引用,或者直接指定它。因此理解优先 级是很重要的。我们在文档前面已经提及它了,但是这里要再次重申:

如果一个属性存在于这些位置,那么 MyBatis 将会按找下面的顺序来加载它们:

-   在 properties 元素体中指定的属性首先被读取,
-   从 properties 元素的类路径 resource 或 url 指定的属性第二个被读取, 可以覆盖已经 指定的重复属性,
-   作为方法参 数传递 的属性最 后被读 取,可以 覆盖已 经从 properties 元 素体和 resource/url 属性中加载的任意重复属性。

因此,最高优先级的属性是通过方法参数传递的,之后是 resource/url 属性指定的,最 后是在 properties 元素体中指定的属性。

总结一下,前四个方法很大程度上是相同的,但是由于可以覆盖,就允许你可选地指定 environment 和/或 properties。 这里给出一个从 mybatis-config.xml 文件创建 SqlSessionFactory 的示例:

```java
    String **resource** = "org/mybatis/builder/mybatis-config.xml";
    InputStream **inputStream** = Resources.getResourceAsStream(resource);
    SqlSessionFactoryBuilder **builder** = new SqlSessionFactoryBuilder();
    SqlSessionFactory **factory** = builder.build(inputStream);
```

注意这里我们使用了 Resources 工具类,这个类在 org.mybatis.io 包中。Resources 类正 如其名,会帮助你从类路径下,文件系统或一个 web URL 加载资源文件。看一下这个类的 源代码或者通过你的 IDE 来查看,就会看到一整套有用的方法。这里给出一个简表:

```java
    URL getResourceURL(String resource)
    URL getResourceURL(ClassLoader loader, String resource)
    InputStream getResourceAsStream(String resource)
    InputStream getResourceAsStream(ClassLoader loader, String resource)
    Properties getResourceAsProperties(String resource)
    Properties getResourceAsProperties(ClassLoader loader, String resource)
    Reader getResourceAsReader(String resource)
    Reader getResourceAsReader(ClassLoader loader, String resource)
    File getResourceAsFile(String resource)
    File getResourceAsFile(ClassLoader loader, String resource)
    InputStream getUrlAsStream(String urlString)
    Reader getUrlAsReader(String urlString)
    Properties getUrlAsProperties(String urlString)
    Class classForName(String className)
```

最后一个 build 方法使用了一个 Configuration 实例。configuration 类包含你可能需要了 解 SqlSessionFactory 实例的所有内容。Configuration 类对于配置的自查很有用,包含查找和 操作 SQL 映射(不推荐使用,因为应用正接收请求) 。configuration 类有所有配置的开关, 这些你已经了解了,只在 Java API 中露出来。这里有一个简单的示例,如何手动配置 configuration 实例,然后将它传递给 build()方法来创建 SqlSessionFactory。

```java
    DataSource dataSource = BaseDataTest.createBlogDataSource();
    TransactionFactory transactionFactory = new JdbcTransactionFactory();

    Environment environment = new Environment("development", transactionFactory, dataSource);

    Configuration configuration = new Configuration(environment);
    configuration.setLazyLoadingEnabled(true);
    configuration.setEnhancementEnabled(true);
    configuration.getTypeAliasRegistry().registerAlias(Blog.class);
    configuration.getTypeAliasRegistry().registerAlias(Post.class);
    configuration.getTypeAliasRegistry().registerAlias(Author.class);
    configuration.addMapper(BoundBlogMapper.class);
    configuration.addMapper(BoundAuthorMapper.class);

    SqlSessionFactoryBuilder builder = new SqlSessionFactoryBuilder();
    SqlSessionFactory factory = builder.build(configuration);
```

现在你有一个 SqlSessionFactory,可以用来创建 SqlSession 实例。

#### SqlSessionFactory

SqlSessionFactory 有六个方法可以用来创建 SqlSession 实例。通常来说,如何决定是你 选择下面这些方法时:

-   **Transaction (事务)**: 你想为 session 使用事务或者使用自动提交(通常意味着很多 数据库和/或 JDBC 驱动没有事务)?
-   **Connection (连接)**: 你想 MyBatis 获得来自配置的数据源的连接还是提供你自己
-   **Execution (执行)**: 你想 MyBatis 复用预处理语句和/或批量更新语句(包括插入和 删除)?

重载的 openSession()方法签名设置允许你选择这些可选中的任何一个组合。

```java
    SqlSession openSession()
    SqlSession openSession(boolean autoCommit)
    SqlSession openSession(Connection connection)
    SqlSession openSession(TransactionIsolationLevel level)
    SqlSession openSession(ExecutorType execType,TransactionIsolationLevel level)
    SqlSession openSession(ExecutorType execType)
    SqlSession openSession(ExecutorType execType, boolean autoCommit)
    SqlSession openSession(ExecutorType execType, Connection connection)
    Configuration getConfiguration();
```

默认的 openSession()方法没有参数,它会创建有如下特性的 SqlSession:

-   会开启一个事务(也就是不自动提交)
-   连接对象会从由活动环境配置的数据源实例中得到。
-   事务隔离级别将会使用驱动或数据源的默认设置。
-   预处理语句不会被复用,也不会批量处理更新。

这些方法大都可以自我解释的。 开启自动提交, "true" 传递 给可选的 autoCommit 参数。 提供自定义的连接,传递一个 Connection 实例给 connection 参数。注意没有覆盖同时设置 Connection 和 autoCommit 两者的方法,因为 MyBatis 会使用当前 connection 对象提供的设 置。 MyBatis 为事务隔离级别调用使用一个 Java 枚举包装器, 称为 TransactionIsolationLevel, 否则它们按预期的方式来工作,并有 JDBC 支持的 5 级 ( NONE,READ_UNCOMMITTED,READ_COMMITTED,REPEA TABLE_READ,SERIALIZA BLE)

还有一个可能对你来说是新见到的参数,就是 ExecutorType。这个枚举类型定义了 3 个 值:

-   `ExecutorType.SIMPLE`: 这个执行器类型不做特殊的事情。它为每个语句的执行创建一个新的预处理语句。
-   `ExecutorType.REUSE`: 这个执行器类型会复用预处理语句。
-   `ExecutorType.BATCH`: 这个执行器会批量执行所有更新语句,如果 SELECT 在它们中间执行还会标定它们是 必须的,来保证一个简单并易于理解的行为。

注意 在 SqlSessionFactory 中还有一个方法我们没有提及,就是 getConfiguration()。这 个方法会返回一个 Configuration 实例,在运行时你可以使用它来自检 MyBatis 的配置。

注意 如果你已经使用之前版本 MyBatis,你要回忆那些 session,transaction 和 batch 都是分离的。现在和以往不同了,这些都包含在 session 的范围内了。你需要处理分开处理 事务或批量操作来得到它们的效果。

#### SqlSession

如上面所提到的,SqlSession 实例在 MyBatis 中是非常强大的一个类。在这里你会发现 所有执行语句的方法,提交或回滚事务,还有获取映射器实例。

在 SqlSession 类中有超过 20 个方法,所以将它们分开成易于理解的组合。

##### 语句执行方法

这些方法被用来执行定义在 SQL 映射的 XML 文件中的 SELECT,INSERT,UPDA E T 和 DELETE 语句。它们都会自行解释,每一句都使用语句的 ID 属性和参数对象,参数可以 是原生类型(自动装箱或包装类) ,JavaBean,POJO 或 Map。

```java
     T selectOne(String statement, Object parameter)
     List selectList(String statement, Object parameter)
     Map selectMap(String statement, Object parameter, String mapKey)
    int insert(String statement, Object parameter)
    int update(String statement, Object parameter)
    int delete(String statement, Object parameter)
```

selectOne 和 selectList 的不同仅仅是 selectOne 必须返回一个对象。 如果多余一个, 或者 没有返回 (或返回了 null) 那么就会抛出异常。 , 如果你不知道需要多少对象, 使用 selectList。

如果你想检查一个对象是否存在,那么最好返回统计数(0 或 1) 。因为并不是所有语句都需 要参数,这些方法都是有不同重载版本的,它们可以不需要参数对象。

```java
     T selectOne(String statement)
     List selectList(String statement)
     Map selectMap(String statement, String mapKey)
    int insert(String statement)
    int update(String statement)
    int delete(String statement)
```

最后,还有查询方法的三个高级版本,它们允许你限制返回行数的范围,或者提供自定 义结果控制逻辑,这通常用于大量的数据集合。

```xml
<E> List<E> selectList (String statement, Object parameter, RowBounds rowBounds)
<K,V> Map<K,V> selectMap(String statement, Object parameter, String mapKey, RowBounds rowbounds)
void select (String statement, Object parameter, ResultHandler<T> handler)
void select (String statement, Object parameter, RowBounds rowBounds, ResultHandler<T> handler)
```

RowBounds 参数会告诉 MyBatis 略过指定数量的记录,还有限制返回结果的数量。 RowBounds 类有一个构造方法来接收 offset 和 limit,否则是不可改变的。

```java
    int offset = 100;
    int limit = 25;
    RowBounds rowBounds = new RowBounds(offset, limit);
```

不同的驱动会实现这方面的不同级别的效率。对于最佳的表现,使用结果集类型的 SCROLL_SENSITIVE 或 SCROLL_INSENSITIVE(或句话说:不是 FORWARD_ONLY)。

ResultHandler 参数允许你按你喜欢的方式处理每一行。你可以将它添加到 List 中,创 建 Map, 或抛出每个结果而不是只保留总计。 Set 你可以使用 ResultHandler 做很多漂亮的事, 那就是 MyBatis 内部创建结果集列表。

它的接口很简单。

```java
    package org.apache.ibatis.session;
    public interface ResultHandler {
      void handleResult(ResultContext context);
    }
```

ResultContext 参数给你访问结果对象本身的方法, 大量结果对象被创建, 你可以使用布 尔返回值的 stop()方法来停止 MyBatis 加载更多的结果。

##### 事务控制方法

控制事务范围有四个方法。 当然, 如果你已经选择了自动提交或你正在使用外部事务管 理器,这就没有任何效果了。然而,如果你正在使用 JDBC 事务管理员,由 Connection 实 例来控制,那么这四个方法就会派上用场:

```java
    void commit()
    void commit(boolean force)
    void rollback()
    void rollback(boolean force)
```

默认情况下 MyBatis 不会自动提交事务, 除非它侦测到有插入, 更新或删除操作改变了 数据库。如果你已经做出了一些改变而没有使用这些方法,那么你可以传递 true 到 commit 和 rollback 方法来保证它会被提交(注意,你不能在自动提交模式下强制 session,或者使用 了外部事务管理器时) 。很多时候你不用调用 rollback(),因为如果你没有调用 commit 时 MyBatis 会替你完成。然而,如果你需要更多对多提交和回滚都可能的 session 的细粒度控 制,你可以使用回滚选择来使它成为可能。

NOTE MyBatis-Spring and MyBatis-Guice provide declarative transaction handling. So if you are using MyBatis with Spring or Guice please refer to their specific manuals.

##### 清理 Session 级的缓存

```java
void clearCache()
```

SqlSession 实例有一个本地缓存在执行 update,commit,rollback 和 close 时被清理。要 明确地关闭它(获取打算做更多的工作) ,你可以调用 clearCache()。

##### 确保 SqlSession 被关闭

```java
void close()
```

你必须保证的最重要的事情是你要关闭所打开的任何 session。保证做到这点的最佳方 式是下面的工作模式:

```java
    SqlSession session = sqlSessionFactory.openSession();
    try {
        // following 3 lines pseudocod for "doing some work"
        session.insert(...);
        session.update(...);
        session.delete(...);
        session.commit();
    } finally {
        session.close();
    }
```

Or, If you are using jdk 1.7+ and MyBatis 3.2+, you can use the try-with-resources statement:

```java
    try (SqlSession session = sqlSessionFactory.openSession()) {
        // following 3 lines pseudocode for "doing some work"
        session.insert(...);
        session.update(...);
        session.delete(...);
        session.commit();
    }
```

注意 就像 SqlSessionFactory,你可以通过调用 getConfiguration()方法获得 SqlSession 使用的 Configuration 实例

```java
    Configuration getConfiguration()
```

##### 使用映射器

```java
     T getMapper(Class type)
```

上述的各个 insert,update,delete 和 select 方法都很强大,但也有些繁琐,没有类型安 全,对于你的 IDE 也没有帮助,还有可能的单元测试。在上面的入门章节中我们已经看到 了一个使用映射器的示例。

因此, 一个更通用的方式来执行映射语句是使用映射器类。 一个映射器类就是一个简单 的接口,其中的方法定义匹配于 SqlSession 方法。下面的示例展示了一些方法签名和它们是 如何映射到 SqlSession 的。

```java
    public interface AuthorMapper {
      // (Author) selectOne("selectAuthor",5);
      Author selectAuthor(int id);
      // (List) selectList("selectAuthors")
      List selectAuthors();
      // (Map) selectMap("selectAuthors", "id")
      @MapKey("id")
      Map selectAuthors();
      // insert("insertAuthor", author)
      int insertAuthor(Author author);
      // updateAuthor("updateAuthor", author)
      int updateAuthor(Author author);
      // delete("deleteAuthor",5)
      int deleteAuthor(int id);
    }
```

总之, 每个映射器方法签名应该匹配相关联的 SqlSession 方法, 而没有字符串参数 ID。 相反,方法名必须匹配映射语句的 ID。

此外,返回类型必须匹配期望的结果类型。所有常用的类型都是支持的,包括:原生类 型,Map,POJO 和 JavaBean。

映射器接口不需要去实现任何接口或扩展任何类。 只要方法前面可以被用来唯一标识对 应的映射语句就可以了。

映射器接口可以扩展其他接口。当使用 XML 来构建映射器接口时要保证在合适的命名 空间中有语句。 而且, 唯一的限制就是你不能在两个继承关系的接口中有相同的方法签名 (这 也是不好的想法)。

你可以传递多个参数给一个映射器方法。 如果你这样做了, 默认情况下它们将会以它们 在参数列表中的位置来命名,比如:#{param1},#{param2}等。如果你想改变参数的名称(只在多参数 情况下) ,那么你可以在参数上使用@Param("paramName")注解。

你也可以给方法传递一个 RowBounds 实例来限制查询结果。

##### 映射器注解

因为最初设计时,MyBatis 是一个 XML 驱动的框架。配置信息是基于 XML 的,而且 映射语句也是定义在 XML 中的。而到了 MyBatis 3,有新的可用的选择了。MyBatis 3 构建 在基于全面而且强大的 Java 配置 API 之上。这个配置 API 是基于 XML 的 MyBatis 配置的 基础,也是新的基于注解配置的基础。注解提供了一种简单的方式来实现简单映射语句,而 不会引入大量的开销。

注意 不幸的是,Java 注解限制了它们的表现和灵活。尽管很多时间都花调查,设计和 实验上,最强大的 MyBatis 映射不能用注解来构建,那并不可笑。C#属性(做示例)就没 有这些限制,因此 MyBatis.NET 将会比 XML 有更丰富的选择。也就是说,基于 Java 注解 的配置离不开它的特性。

**注解有下面这些:**

| 注解 | 目标 | 相对应的 XML | 描述 |
| --- | --- | --- | --- |
| `@CacheNamespace` | `类` | `` | 为给定的命名空间 (比如类) 配置缓存。 属性:implemetation,eviction, flushInterval,size 和 readWrite。 |
| `@CacheNamespaceRef` | `类` | `` | 参照另外一个命名空间的缓存来使用。 属性:value,应该是一个名空间的字 符串值(也就是类的完全限定名) 。 |
| `@ConstructorArgs` | `Method` | `` | 收集一组结果传递给一个劫夺对象的 构造方法。属性:value,是形式参数 的数组。 |
| `@Arg` | `方法` |  | 单 独 的 构 造 方 法 参 数 , 是 ConstructorArgs 集合的一部分。属性: id,column,javaType,typeHandler。 id 属性是布尔值, 来标识用于比较的属 性,和XML 元素相似。 |
| `@TypeDiscriminator` | `方法` | `` | 一组实例值被用来决定结果映射的表 现。 属性: column, javaType, jdbcType, typeHandler,cases。cases 属性就是实 例的数组。 |
| `@Case` | `方法` | `` | 单独实例的值和它对应的映射。属性: value,type,results。Results 属性是结 果数组,因此这个注解和实际的 ResultMap 很相似,由下面的 Results 注解指定。 |
| `@Results` | `方法` | `` | 结果映射的列表, 包含了一个特别结果 列如何被映射到属性或字段的详情。 属 性:value,是 Result 注解的数组。 |
| `@Result` | `方法` |  | 在列和属性或字段之间的单独结果映 射。属 性:id,column, property, javaType ,jdbcType ,type Handler, one,many。id 属性是一个布尔值,表 示了应该被用于比较(和在 XML 映射 中的相似)的属性。one 属性是单 独 的 联 系, 和 相 似 , 而 many 属 性 是 对 集 合 而 言 的 , 和 相似。 它们这样命名是为了 避免名称冲突。 |
| `@One` | `方法` | `` | 复杂类型的单独属性值映射。属性: select,已映射语句(也就是映射器方 法)的完全限定名,它可以加载合适类 型的实例。注意:联合映射在注解 API 中是不支持的。这是因为 Java 注解的 限制,不允许循环引用。`fetchType`, which supersedes the global configuration parameter`lazyLoadingEnabled` for this mapping. |
| `@Many` | `方法` | `` | A mapping to a collection property of a complex type. Attributes:`select`, which is the fully qualified name of a mapped statement (i.e. mapper method) that can load a collection of instances of the appropriate types,`fetchType`, which supersedes the global configuration parameter`lazyLoadingEnabled` for this mapping. NOTE You will notice that join mapping is not supported via the Annotations API. This is due to the limitation in Java Annotations that does not allow for circular references. |
| `@MapKey` | `方法` |  | 复 杂 类 型 的 集合 属 性 映射 。 属 性 : select,是映射语句(也就是映射器方 法)的完全限定名,它可以加载合适类 型的一组实例。注意:联合映射在 Java 注解中是不支持的。这是因为 Java 注 解的限制,不允许循环引用。 |
| `@Options` | `方法` | 映射语句的属性 | 这个注解提供访问交换和配置选项的 宽广范围, 它们通常在映射语句上作为 属性出现。 而不是将每条语句注解变复 杂,Options 注解提供连贯清晰的方式 来访问它们。属性:useCache=true , flushCache=false , resultSetType=FORWARD_ONLY , statementType=PREPARED , fetchSize=-1 , , timeout=-1 useGeneratedKeys=false , keyProperty="id"。 理解 Java 注解是很 重要的,因为没有办法来指定"null" 作为值。因此,一旦你使用了 Options 注解,语句就受所有默认值的支配。要 注意什么样的默认值来避免不期望的 行为。 |
| * `@Insert`,`@Update`, `@Delete`, `@Select` | `方法` | `<insert>`,`<update>`,`<delete>`,`<select>` | 这些注解中的每一个代表了执行的真 实 SQL。 它们每一个都使用字符串数组 (或单独的字符串)。如果传递的是字 符串数组, 它们由每个分隔它们的单独 空间串联起来。这就当用 Java 代码构 建 SQL 时避免了"丢失空间"的问题。 然而,如果你喜欢,也欢迎你串联单独 的字符串。属性:value,这是字符串 数组用来组成单独的 SQL 语句。 |
| @InsertProvider,@UpdateProvider,@DeleteProvider,@SelectProvider | 方法 | `<insert>`,`<update>`,`<delete>`,`<select>` | 这些可选的 SQL 注解允许你指定一个 类名和一个方法在执行时来返回运行 允许创建动态 的 SQL。 基于执行的映射语句, MyBatis 会实例化这个类,然后执行由 provider 指定的方法. 这个方法可以选择性的接 受参数对象作为它的唯一参数, 但是必 须只指定该参数或者没有参数。属性: type,method。type 属性是类的完全限 定名。method 是该类中的那个方法名。 注意: 这节之后是对 SelectBuilder 类的 讨论,它可以帮助你以干净,容于阅读 的方式来构建动态 SQL。 |
| `@Param` | `Parameter` | N/A | 如果你的映射器的方法需要多个参数, 这个注解可以被应用于映射器的方法 参数来给每个参数一个名字。否则,多 参数将会以它们的顺序位置来被命名 (不包括任何 RowBounds 参数) 比如。 #{param1} , #{param2} 等 , 这 是 默 认 的 。 使 用 @Param("person"),参数应该被命名为 #{person}。 |
| `@SelectKey` | `Method` | `<selectKey>` | This annotation duplicates the `` functionality for methods annotated with`@Insert`,`@InsertProvider`,`@Update`or`@UpdateProvider`. It is ignored for other methods. If you specify a`@SelectKey`annotation, then MyBatis will ignore any generated key properties set via the`@Options`annotation, or configuration properties. Attributes: statement an array of strings which is the SQL statement to execute,`keyProperty`which is the property of the parameter object that will be updated with the new value, before which must be either`true`or`false`to denote if the SQL statement should be executed before or after the insert,`resultType`which is the Java type of the`keyProperty`, and`statementType=PREPARED`. |
| `@ResultMap` | `Method` | N/A | This annotation is used to provide the id of a `` element in an XML mapper to a`@Select`or`@SelectProvider`annotation. This allows annotated selects to reuse resultmaps that are defined in XML. This annotation will override any`@Results`or`@ConstructorArgs` annotation if both are specified on an annotated select. |
| `@ResultType` | `Method` | N/A | This annotation is used when using a result handler. In that case, the return type is void so MyBatis must have a way to determine the type of object to construct for each row. If there is an XML result map, use the @ResultMap annotation. If the result type is specified in XML on the ` Night Mode |

#### 映射申明样例

这个例子展示了如何使用 @SelectKey 注解来在插入前读取数据库序列的值：

```java
@Insert("insert into table3 (id, name) values(#{nameId}, #{name})")
@SelectKey(statement="call next value for TestSequence", keyProperty="nameId", before=true, resultType=int.class)
int insertTable3(Name name);
```

这个例子展示了如何使用 @SelectKey 注解来在插入后读取数据库识别列的值：

```java
@Insert("insert into table2 (name) values(#{name})")
@SelectKey(statement="call identity()", keyProperty="nameId", before=false, resultType=int.class)
int insertTable2(Name name);
```

>作者:W3Cschool 
>来源:https://www.w3cschool.cn/mybatis/ud8n1im1.html
