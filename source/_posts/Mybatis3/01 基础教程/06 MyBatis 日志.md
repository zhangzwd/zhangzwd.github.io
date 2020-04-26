---
title: MyBatis 日志
tags:
  - Java
  - MyBatis
  - MyBatis基础教程
copyright: true
categories:
  - MyBatis基础教程
translate_title: mybatis-log
special: m3
show_title: mybatis-log
date: 2019-10-17 09:22:33
---

Logging
-------

Mybatis内置的日志工厂提供日志功能，具体的日志实现有以下几种工具：

-   SLF4J
-   Apache Commons Logging
-   Log4j 2
-   Log4j
-   JDK logging

具体选择哪个日志实现工具由MyBatis的内置日志工厂确定。它会使用最先找到的（按上文列举的顺序查找）。 如果一个都未找到，日志功能就会被禁用。

不少应用服务器的classpath中已经包含Commons Logging，如Tomcat和WebShpere， 所以MyBatis会把它作为具体的日志实现。记住这点非常重要。这将意味着，在诸如 WebSphere的环境中------WebSphere提供了Commons Logging的私有实现，你的Log4J配置将被忽略。 这种做法不免让人悲催，MyBatis怎么能忽略你的配置呢？事实上，因Commons Logging已经存 在了，按照优先级顺序，Log4J自然就被忽略了！不过，如果你的应用部署在一个包含Commons Logging的环境， 而你又想用其他的日志框架，你可以根据需要调用如下的某一方法：

```java
org.apache.ibatis.logging.LogFactory.useSlf4jLogging();
org.apache.ibatis.logging.LogFactory.useLog4JLogging();
org.apache.ibatis.logging.LogFactory.useJdkLogging();
org.apache.ibatis.logging.LogFactory.useCommonsLogging();
org.apache.ibatis.logging.LogFactory.useStdOutLogging();
```

如果的确需要调用以上的某个方法，请在其他所有MyBatis方法之前调用它。另外，只有在相应日志实现中存在 的前提下，调用对应的方法才是有意义的，否则MyBatis一概忽略。如你环境中并不存在Log4J，你却调用了 相应的方法，MyBatis就会忽略这一调用，代之默认的查找顺序查找日志实现。

关于SLF4J、Apache Commons Logging、Apache Log4J和JDK Logging的API介绍已经超出本文档的范围。 不过，下面的例子可以作为一个快速入门。关于这些日志框架的更多信息，可以参考以下链接：

-   [Apache Commons Logging](http://commons.apache.org/proper/commons-logging/)
-   [Apache Log4j](http://logging.apache.org/log4j/2.x/)
-   [JDK Logging API](http://www.oracle.com/technetwork/java/index.html)

Logging Configuration
---------------------

MyBatis可以对包、类、命名空间和全限定的语句记录日志。

具体怎么做，视使用的日志框架而定，这里以Log4J为例。配置日志功能非常简单：添加几个配置文件， 如log4j.properties,再添加个jar包，如log4j.jar。下面是具体的例子，共两个步骤：

#### 步骤1： 添加 Log4J 的 jar 包

因为采用Log4J，要确保在应用中对应的jar包是可用的。要满足这一点，只要将jar包添加到应用的classpath中即可。 Log4J的jar包可以从上面的链接中下载。

具体而言，对于web或企业应用，需要将`log4j.jar` 添加到`WEB-INF/lib` 目录； 对于独立应用， 可以将它添加到jvm的 `-classpath`启动参数中。

#### 步骤2：配置Log4J

配置Log4J比较简单， 比如需要记录这个mapper接口的日志:

```java
    package org.mybatis.example;
    public interface BlogMapper {
      @Select("SELECT * FROM blog WHERE id = #{id}")
      Blog selectBlog(int id);
    }
```

只要在应用的classpath中创建一个名称为`log4j.properties`的文件， 文件的具体内容如下：

```yml
    # Global logging configuration
    log4j.rootLogger=ERROR, stdout
    # MyBatis logging configuration...
    log4j.logger.org.mybatis.example.BlogMapper=TRACE
    # Console output...
    log4j.appender.stdout=org.apache.log4j.ConsoleAppender
    log4j.appender.stdout.layout=org.apache.log4j.PatternLayout
    log4j.appender.stdout.layout.ConversionPattern=%5p [%t] - %m%n
```

添加以上配置后，Log4J就会把 `org.mybatis.example.BlogMapper` 的详细执行日志记录下来，对于应用中的其它类则仅仅记录错误信息。

也可以将日志从整个mapper接口级别调整到到语句级别，从而实现更细粒度的控制。如下配置只记录 `selectBlog` 语句的日志：

```yml
log4j.logger.org.mybatis.example.BlogMapper.selectBlog=TRACE
```

与此相对，可以对一组mapper接口记录日志，只要对mapper接口所在的包开启日志功能即可：

```yml
    log4j.logger.org.mybatis.example=TRACE
```

某些查询可能会返回大量的数据，只想记录其执行的SQL语句该怎么办？为此，Mybatis中SQL语 句的日志级别被设为DEBUG（JDK Logging中为FINE），结果日志的级别为TRACE（JDK Logging中为FINER)。所以，只要将日志级别调整为DEBUG即可达到目的：

```yml
    log4j.logger.org.mybatis.example=DEBUG
```

要记录日志的是类似下面的mapper文件而不是mapper接口又该怎么呢？

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
  PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="org.mybatis.example.BlogMapper">
  <select id="selectBlog" resultType="Blog">
    select * from Blog where id = #{id}
  </select>
</mapper>
```

对这个文件记录日志，只要对命名空间增加日志记录功能即可：

```yml
    log4j.logger.org.mybatis.example.BlogMapper=TRACE
```

进一步，要记录具体语句的日志可以这样做：

```yml
log4j.logger.org.mybatis.example.BlogMapper.selectBlog=TRACE
```

看到了吧，两种配置没差别！

配置文件`log4j.properties`的余下内容是针对日志格式的，这一内容已经超出本 文档范围。关于Log4J的更多内容，可以参考Log4J的网站。不过，可以简单试一下看看，不同的配置 会产生什么不一样的效果。



>作者:W3Cschool 
>来源:https://www.w3cschool.cn/mybatis/ogqn1im5.html
