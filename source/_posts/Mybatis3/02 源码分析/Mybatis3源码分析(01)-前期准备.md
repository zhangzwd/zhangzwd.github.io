---
title: MyBatis3源码解析-前期准备
tags:
  - MyBatis3源码解析
copyright: false
categories:
  - MyBatis3源码解析
translate_title: mybatis3-source-code-analysis---preliminary-preparation
special: m3s
original: false
reproduced: true
date: 2020-03-17 16:51:52
show_title: mybatis3-source-code-preparation
---

### 背景
我们大多项目都使用了 Mybatis。Mybatis 的中的 sql 大多都是配置在 xml 文件中的，我们为了方便 dba 对 sql 统一的管理需要将 sql 保存在数据库中。这样就要求 Mybatis 从数据库中加载配置，同时 dba 优化 sql 之后还得实现让 Mybatis 在不重启应用的情况下动态加载。要实现这些功能，需要对 Mybatis 进行扩展，所以本人花了一些时间分析一 Mybatis3 源码，在此记录。

### 分析计划
主要分析如下三大内容:

1.  分析 Mybatis 是怎么解析配置文件
2.  分析 Mybatis 是如何执行 Sql 并映射结果
3.  分析 Mybatis 是如何使用缓存的

### 技术要求

1.  core java。尤其是 jdbc 部分。
2.  基本的 xml 知识。
3.  以上都具备的话，还需要花点时间看看 Mybatis

### 环境准备

在 eclipse 中新建一个普通的 maven 工程，并加上 Mybatis 的依赖

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
      <modelVersion>4.0.0</modelVersion>
      <groupId>com.ashan</groupId>
      <artifactId>mybatis</artifactId>
      <version>0.0.1-SNAPSHOT</version>
      <dependencies>
            <dependency>
                  <groupId>org.mybatis</groupId>
                  <artifactId>mybatis</artifactId>
                  <version>3.2.6</version>
            </dependency>
            <dependency>
                  <groupId>mysql</groupId>
                  <artifactId>mysql-connector-java</artifactId>
                  <version>5.1.26</version>
            </dependency>
            <dependency>
                  <groupId>commons-lang</groupId>
                  <artifactId>commons-lang</artifactId>
                  <version>2.5</version>
            </dependency>
      </dependencies>
</project>
```

### 数据模型

电信行业最简单的三户模型：客户、用户、账户

1.  客户：即一个证件对应一个客户
2.  用户：一个电话号码或宽带账号对应一个用户
3.  账户：一个银行账户对应一个账户

这里假定这个情形：你拿身份证去电信运营商里办了一个号码，并且提供了两个银行账户，每个月都可以使用这两个账号自动交话费。

#### 用户定义

```java
package com.ashan.mybatis;

import java.util.List;

public class User {
    /**
     * 用户id，主键
     */
    private String id;

    private String username;

    /**
     * 用户号码
     */
    private String svcnum;

    private String password;

    /**
     * 一个用户只能对应一个客户
     */
    private Cust cust;

    /**
     * 一个用户可以有多个账户
     */
    private List<Acct> accts;

    /**
     * 用户类型，两种：普通用户和重要用户
     */
    private UserType type;


    public User(String id, String username) {
        super();
        this.id = id;
        this.username = username;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public Cust getCust() {
        return cust;
    }

    public void setCust(Cust cust) {
        this.cust = cust;
    }

    public List<Acct> getAccts() {
        return accts;
    }

    public void setAccts(List<Acct> accts) {
        this.accts = accts;
    }

    public UserType getType() {
        return type;
    }

    public void setType(UserType type) {
        this.type = type;
    }

    public String getSvcnum() {
        return svcnum;
    }

    public void setSvcnum(String svcnum) {
        this.svcnum = svcnum;
    }

}
```

#### 用户定义

```java
package com.ashan.mybatis;

public class Cust {
    private String id;

    private String custname;

    /**
     * 证件号码
     */
    private String certNo;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getCustname() {
        return custname;
    }

    public void setCustname(String custname) {
        this.custname = custname;
    }

    public String getCertNo() {
        return certNo;
    }

    public void setCertNo(String certNo) {
        this.certNo = certNo;
    }

}
```

#### 账户定义

```java
package com.ashan.mybatis;

public class Acct {
    private String id;

    private String payName;

    /**
     * 银行账号
     */
    private String bankNo;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getPayName() {
        return payName;
    }

    public void setPayName(String payName) {
        this.payName = payName;
    }

    public String getBankNo() {
        return bankNo;
    }

    public void setBankNo(String bankNo) {
        this.bankNo = bankNo;
    }
}
```

#### 用户类型

```java
package com.ashan.mybatis;

public enum UserType {
    /**
     * 普通用户
     */
    GENERAL,

    /**
     * 重要用户
     */
    IMPORTANT
}
```

### Mybatis 配置

#### mybatis-config.xml

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE configuration
  PUBLIC '-//mybatis.org//DTD Config 3.0//EN'
  'http://mybatis.org/dtd/mybatis-3-config.dtd'>
<configuration>
    <properties resource="db.properties"/>
    <environments default="development">
        <environment id="development">
            <transactionManager type="JDBC"/>
            <dataSource type="POOLED">
                <property name="driver" value="${driver}"/>
                <property name="url" value="${url}"/>
                <property name="username" value="${username}"/>
                <property name="password" value="${password}"/>
            </dataSource>
        </environment>
    </environments>
    <mappers>
        <mapper resource="UserMapper.xml"/>
    </mappers>
</configuration>
```

#### UserMapper.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper
  PUBLIC '-//mybatis.org//DTD Mapper 3.0//EN'
  'http://mybatis.org/dtd/mybatis-3-mapper.dtd'>
<mapper namespace="com.ashan.user">
    <resultMap id="detailUserResultMap" type="com.ashan.mybatis.User">
        <constructor>
            <idArg column="user_id" javaType="String"/>
            <arg column="user_name"/>
        </constructor>
        <result column="user_pwd" property="password"/>
        <result column="user_type" javaType="com.ashan.mybatis.UserType" property="type" typeHandler="com.ashan.mybatis.UserTypeHandler"/>
        <result column="svc_num" property="svcnum"/>
        <association javaType="com.ashan.mybatis.Cust" property="cust">
            <id column="cust_id" property="id"/>
            <result column="cust_name" property="custname"/>
            <result column="cert_no" property="certNo"/>
        </association>
        <collection ofType="com.ashan.mybatis.Acct" property="accts">
            <id column="acct_id" property="id"/>
            <result column="pay_name" property="payName"/>
            <result column="bank_no" property="bankNo"/>
        </collection>
    </resultMap>
    <select id="selectUserDetail" resultMap="detailUserResultMap">
        <![CDATA[
                select user_id,user_name,user_type,cust_id from tf_f_user a where a.user_id=#{userId}
            ]]>
    </select>
</mapper>
```

### 跑跑试试看有没有问题

```java
package com.ashan.mybatis;

import java.io.InputStream;

import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;

public class SqlSesstionFactoryTest {
    public static void main(String[] args) throws Exception {
        String resouce = "mybatis-config.xml";
        InputStream is = Resources.getResourceAsStream(resouce);
        SqlSessionFactory sqlSessionFactory = new SqlSessionFactoryBuilder().build(is);
        System.out.println(sqlSessionFactory.getConfiguration());
    }
}
```

运行没有异常说明配置 OK!

### 其他说明

搭建这个环境的作用是为了在分析代码过程中进行 Debuger，有些时候源代码很难明白，Debuger 一下能知道代码的走向，有时源代码看明白了，Debuger 一下也能帮助验证自己的理解是否有错。Debuger 对分析源码非常有用。

使用 Maven 构建这个工程除了方便 jar 导入之后，还有一个用处就是在 eclipse 中查看源代码非常方便。在 eclipse 使用 maven 工程，eclipse 会自动下载并关联源代码。

> 作者：ashan_li
> 链接：http://suo.im/5xmz3s
