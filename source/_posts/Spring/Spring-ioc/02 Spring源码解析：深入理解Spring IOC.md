---
title: 深入理解Spring IOC
tags:
  - Spring
copyright: true
categories:
  - Spring源码解析
translate_title: deep-understanding-of-spring-ioc
special: spring-ioc
original: true
reproduced: true
show_title: deep-understanding-of-spring-ioc
date: 2020-06-23 19:53:35
---

Spring IOC作为Spring中第一核心概念，我们在学习Spring之初就接触过了。但是我们在研究探索Spring IOC源码之前，还是需要对Spring IOC的概念做一个深入的理解。此篇作为【Spring源码解析】系列的真正的第一篇，我们来对IOC做一个深入的理解和探究。

### 什么是Spring IOC

什么是Spring IOC？这是一道在面试中会经常被问道的题目。IOC的全称是` Inversion of Control `，被译为“控制反转”，它还有一个别名叫做依赖注入DI（`dependency injection`）。但是在有的书中，会将依赖注入当做是IOC的一种实现方式，但是博主在查看Spring的官方文档时，它是这样说的：

>   IoC is also known as dependency injection (DI)

我们可以看到，Spring的官方文档上将依赖注入（ID）和IOC（控制反转）当做的是同一个概念。以后我们可以大胆的告诉面试官，IOC就是依赖注入，只是同一个概念不同的说法而已。回到IOC（`控制反转`）上面，要搞懂IOC（`控制反转`）首先要搞懂以下几个问题：

1.  谁控制了谁？
2.  怎么控制的？
3.  何为反转？

在回答上面的问题之前，我们先看一个简单的示例

```java
public class Human {
	private Car car;

	public void setCar(Car car) {
		this.car = car;
	}

	public static void main(String[] args) {
		Human human = new Human();
		Car car = new Car();
		human.setCar(car);
		
	}
}
```

上面的示例中是我们通常的做法，在我们需要依赖某个类或者服务时，通常的做法就是将其直接创建出来（`new Car()`）,然后将创建出来的对象提供给使用者让其使用。这就使得我们的对象和其依赖的对象紧紧的耦合在一起了，如果有一天，我们想对其依赖的对象进行更换，那将是一个极其痛苦的事情。

再回头想想，我们是否真的有必要在每次使用到依赖对象的时候，将其主动的创建出来？我们在使用到依赖对象时，只是使用到依赖对象提供的某项服务而已，只要在我们用到这个依赖对象的服务时，它能够准备就绪就好，至于这个依赖对象是我们主动创建还是由别人提供的我们并不关心，再说，相对于我们自己主动创建还需要大费周折的维护它，由别人提供不是会更好吗？

在这里，提供我们东西的“人”就是IOC，在上面的示例中，IOC就相当于租车公司，你要什么车，只要你把要求告诉给租车公司，它就会提供你什么车，我们只需要关注怎么使用就行了，完全不需要我们再去造一个车出来然后再使用。所以说简单点，IOC的理念就是，让别人为你服务。如下图所示：

![image-20200508220836602](http://cdn.zzwzdx.cn/blog/image-20200508220836602.png&blog)

在没有引入IOC之前，被注入的对象会直接依赖于依赖对象，在使用了IOC后，两者及其他们关系都是通过`IOC Service Provider`来统一维护管理的。被注入的对象需要什么，直接跟 `IOC Service Provider` 打招呼，后者就会把相应的被依赖对象注入到被注入对象中，从而达到 `IOC Service Provider` 为备注入对象提供提供服务的目的。**其实IOC就是这么简单！原来需要什么东西自己去拿，现在是需要什么东西就让别人送过来。**

明白`IOC` 的核心理念，现在我们来回答上面的问题就非常简单了。

**谁控制了谁：**IOC容器控制对象，不论是被注入对象还是依赖对象都是交给IOC容器来管理的。

**怎么控制的：** IOC容器提供了3种方式来完成将依赖对象注入到被注入对象中，至于是哪三种方式，我们后面会说到。

**何为反转：** 在IOC出现之前，我们都是主动的去创建依赖对象，这是正传。在使用IOC之后，所有依赖的对象都是由IOC容器创建后提供给被注入对象的，依赖的对象从主动的创建变成被动的接受，这就是反转。

### 注入方式

前面提到过，IOC容器提供了3种方式来完成将依赖对象注入到被注入对象中，这3种方式分别是：

*   构造注入
*   setter方法注入
*   接口注入

下面我们来看看每种方式是如何完成的。

#### 构造注入

构造注入，顾名思义就是在构造方法中完成将依赖对象注入到被注入对象中去。被注入的对象可以在构造函数中声明依赖对象的参数列表，让IOC容器知道它需要哪些依赖对象。还是以上面为例，构造注入的实现如下：

```java
public class Human {
	private Car car;

	public Human(Car car){
		this.car = car;
	}
}
```

构造方法注入方式比较直观，对象被构造完成后，即进入就绪状态，可以马上使用 。

#### Setter方法注入

对于JavaBean对象来说，我们通常都是通过setter和getter方法来访问和设置相应的属性，所以被注入对象只需要提供依赖对象的setter方法，IOC容器就会将依赖对象注入到被注入对象中去。示例如下：

```java
public class Human {
	private Car car;

	public void setCar(Car car) {
		this.car = car;
	}
}
```

相比较于`构造注入`， `setter方法注入`会显得更宽松一些，它可以在对象构造完成后的任何时间点注入，只需要在使用依赖对象之前即可。

#### 接口注入

相比较于前2种注入方式，接口注入显得更加的霸道和侵入性。因为它需要被注入对象实现一个接口，这个接口中提供一个方法，用来为其注入依赖对象。这种方式基本处于“退役状态”，并且在Spring中也并没有实现接口注入，所以博主在这里就不演示了。

### 核心组件

我们在上面深入的分析了IOC的核心概念后，我们再来看看组成Spring IOC组成的核心组件。

#### ApplicationContext体系

首先我们来看下我们大名鼎鼎的`applicationContext`的类图。

![ApplicationContext](http://cdn.zzwzdx.cn/blog/ApplicationContext.png&blog)

从上面 `applicationContext`的类图中，我们可以看到 `applicationContext` 即继承了顶级接口 `ResourceLoader` 又继承了顶级接口 `BeanFactory`。

因此`applicationContext` 与`BeanFactory`的区别在于，`applicationContext` 不仅能够完成对`Bean`的管理而且还额外的提供了如下功能：

*    **资源访问（如URL和文件）**
*   **事件机制**
*   **解决消息的能力，支持国际化**

对于`applicationContext` 我们最熟悉的莫过于`ClassPathXmlApplicationContext`和`AnnotationConfigApplicationContext`了，`ClassPathXmlApplicationContext`是用于加载xml文件，并解析xml,然后将xml文件中配置的类实例化并装载到容器中。`AnnotationConfigApplicationContext`和`ClassPathXmlApplicationContext`原理类似，只不过`AnnotationConfigApplicationContext`是用来加载注解类的。除了这2个类外，还有一些其它的实现，比如`FileSystemXmlApplicationContext`、`GenericGroovyApplicationContext`、`GenericXmlApplicationContext`等等，只不过相比于前面2个，这些都不是很常用而已。

说完了`applicationContext` ，我们再来看看`applicationContext` 类图中的2个顶级接口。

#### Resource体系

ResourceLoader是用于加载resources的一个策略，我们先来看看ResourceLoader接口的定义:

```java
public interface ResourceLoader {

	String CLASSPATH_URL_PREFIX = ResourceUtils.CLASSPATH_URL_PREFIX;

	/**
	 * 根据指定的资源，返回Resource对象
	 * 
	 * @param location
	 * 例如：file:C:/test.dat
	 * 		classpath:test.dat
	 * 		WEB-INF/test.dat	
	 * @return
	 */
	Resource getResource(String location);

	/**
	 * 获取ClassLoader
	 * @return
	 */
	@Nullable
	ClassLoader getClassLoader();

}
```

从上面`ResourceLoader`的源码中我们可以看到，其主要的功能就是将一个资源文件路径装加载为`Resource`对象。然后通过`BeanDefinitionReader`将`Resource`中的类信息加载成`BeanDefinition`。

`Resource`和`ResouceLoader`的类图如下：

##### Resource类图

![Resource](http://cdn.zzwzdx.cn/blog/Resource.png&blog)

##### ResourceLoader类图

![ResourceLoader](http://cdn.zzwzdx.cn/blog/ResourceLoader.png&blog)

#### BeanFactory体系

`BeanFactory` 是我们Spring IOC 中非常重要的一块，它是用于访问Spring Bean容器的根接口。它为我们Spring IOC 容器提供了最底层的支持。说的简单点，就是BeanFactory的主要功能就是管理我们容器中的Bean。其体系结构如下：

![BeanFactory](http://cdn.zzwzdx.cn/blog/BeanFactory.png&blog)

#### BeanDefinitionReader体系

在上面的Resource系统中，我们提到BeanDefinitionReader将Resource中的类信息加载为BeanDefinition，因此BeanDefinitionReader和BeanDefinition也是我们Spring IOC容器中非常重要的一个体系结构，我们先来看BeanDefinitionReader。BeanDefinitionReader类图如下：

![BeanDefinitionReader](http://cdn.zzwzdx.cn/blog/BeanDefinitionReader.png&blog)

可以看到上面的`BeanDefinitionReader`体系都是基于配置的，基于注解的是`AnnotatedBeanDefinitionReader`，它就是一个单独的类，用于处理基于注解的配置。其类图如下：

![AnnotatedBeanDefinitionReader](http://cdn.zzwzdx.cn/blog/AnnotatedBeanDefinitionReader.png&blog)

#### BeanDefinition体系

BeanDefinition是Spring用来描述Bean的信息的类，其类图如下：

![BeanDefinition](http://cdn.zzwzdx.cn/blog/BeanDefinition.png&blog)



上面的五个体系，不，应该是六个体系，`AnnotatedBeanDefinitionReader`应该单独算一个体系。这六个系统是我们Spring IOC中最核心的部分，后面博主将根据这六个体系来分析Spring IOC的源码和实现原理。

