---
title: Spring源码环境搭建
tags:
  - Spring
copyright: true
categories:
  - Spring源码解析
translate_title: spring-source-environment-construction
special: spring-ioc
original: true
reproduced: true
date: 2020-06-21 19:09:26
show_title: spring-source-environment
---

###  Gradle安装

gradle安装文档地址：https://gradle.org/install/  官网上详细的介绍了如何安装Gradle。

Windows平台下，需要配置gradle的环境变量。

-   新增 `GRADLE_HOME` 环境变量，指向Gradle解压目录
-   配置Path环境变量:新增 `%GRADLE_HOME%\bin`

完成配置后，输入`gradle -v`会显示gradle的版本号，表示gradle安装成功。

![image-20200429221410367](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200429221410367.png)



### 下载Spring源码

Spring源码下载在github上找到spring-projects/*spring*-framework，选择版本后将其下载到本地。

### Spring源码编译

进入 `spring-framework` 文件夹下，打开cmd，输入 `gradlew :spring-oxm:compileTestJava` 进行编译。在编译的过程中可能出现错误，重试几次就可以了。

![image-20200430091342847](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430091342847.png)

### 导入项目

打开IDEA依次打开File -> New -> Project from Existing Sources -> Navigate to directory -> Select build.gradle，点击OK导入项目

导入项目完成后，修改gradle和Jdk的配置信息。

![image-20200430101715846](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430101715846.png)

修改完成后，查看源码中是否包含`spring-aspects`模块，如果存在，则需要将`spring-aspects`排除编译。

File -> Project Structure -> Modules

![image-20200430102139508](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430102139508.png)

构建项目，等待IDEA工具编译完成。

在构建的过程中可能会出现如下的错误

![image-20200430102604467](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430102604467.png)

这是因为gradle的版本太高的原因，有2种解决方案，一是将自己本地的gradle的版本减低，二是提高build-scan的版本，这里博主用的是第一种方案。

### 测试

在spring的工程项目中新建测试模块，在工程目录项右键-->New-->Module

![image-20200430112732589](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430112732589.png)

新建项目完成后，配置build.gradle,在 dependencies 里面添加 compile(project(":spring-context"))  spring-context的依赖。

最后运行测试

![image-20200430115639706](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430115639706.png)

可以看到正常的输出了打印的信息

![image-20200430115708533](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/image-20200430115708533.png)

此时，spring源码环境即搭建完成。



>   **当前Spring的版本为5.2.3，后面Spring的源码分析都是基于此版本。 后面的系列文章均是LZ 学习、研究 Spring 源码的学习笔记，如有错误之处，望各位大佬指出，不胜感激。**
