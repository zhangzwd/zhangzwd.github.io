---
title: JMM之happens-before
tags:
  - Java
  - 线程
  - happends-before
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: happens-before-of-jmm
show_title: jmms-happensbefore
original: true
date: 2019-06-06 10:02:45
---
在JMM中有一个很重要的概念对于我们了解JMM有很大的帮助，那就是happens-before规则。happens-before规则非常重要，它是判断数据是否存在竞争、线程是否安全的主要依据。JSR-133S使用happens-before概念阐述了两个操作之间的内存可见性。在JMM中，如果一个操作的结果需要对另一个操作可见，那么这两个操作则存在happens-before关系。

 那什么是happens-before呢？在JSR-133中，happens-before关系定义如下：

1. 如果一个操作happens-before另一个操作，那么意味着第一个操作的结果对第二个操作可见，而且第一个操作的执行顺序将排在第二个操作的前面。
2. 两个操作之间存在happens-before关系，并不意味着Java平台的具体实现必须按照happens-before关系指定的顺序来执行。如果重排序之后的结果，与按照happens-before关系来执行的结果一致，那么这种重排序并不非法（也就是说，JMM允许这种重排序）

happens-before规则如下：

1. 程序顺序规则：一个线程中的每一个操作，happens-before于该线程中的任意后续操作。
2. 监视器规则：对一个锁的解锁，happens-before与随后对这个锁的加锁。
3. volatile规则：对一个volatile变量的写，happens-before于任意后续对一个volatile变量的读。
4. 传递性：如果A happens-before B，B happens-before C，那么A happens-before C。
5. 线程启动规则：Thread对象的start()方法，happens-before于这个线程的任意后续操作。
6. 线程终止规则：线程中的任意操作，happens-before于该线程的终止监测。我们可以通过Thread.join()方法结束、Thread.isAlive()的返回值等手段检测到线程已经终止执行。
7. 线程中断操作：对线程interrupt()方法的调用，happens-before于被中断线程的代码检测到中断事件的发生，可以通过Thread.interrupted()方法检测到线程是否有中断发生。
8. 对象终结规则：一个对象的初始化完成，happens-before于这个对象的finalize()方法的开始。

以上8条happens-before规则都比较简单，这里LZ只分析第3条volatile变量规则，分析如下：

![happens-before之volatile规则](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/happens-before之volatile规则.png)

从上图中，我们看到存在4条happens-before关系，它们分别如下：

* 1 happens-before 2 和 3 happens-before 4 是有由程序顺序性规则产生的。
* 2 happens-before 3 是由volatile规则产生的。上面提到过，一个volatile变量的读，总能看到之前对这个volatile变量的写入。
* 1 happens-before 4 是由传递性规则产生的。

读到这里，可能很多同学会把happens-before理解为“时间上的先后顺序”，在这里LZ特别强调**happens-hefore不能理解为“时间上的先后顺序”**，下面LZ用一段代码解释写happens-before和“时间上的先后顺序”的不同，代码如下：

```java
public class VolatileTest4 {
    private int a = 0;
    public int getA() {
        return a;
    }
    public void setA(int a) {
        this.a = a;
    }
}
```

上面代码就是一组简单的setter/getter方法，现在假设现在有两个线程A和B，线程A先(这里指时间上的先执行)执行setA(10)，然后线程B访问同一个对象的getA()方法，那么此时线程B收到的返回值是多少呢？

答案是：**不确定**

我们来一次分析下happens-before的各项原则：

1. 这里两个方法分别是在两个线程中被调用，不在一个线程中，这里程序顺序性就不适用了
2. 代码中没有同步块，所有监视器规则也不适用
3. 代码中变量a是一个普通变量，所以volatile规则也不适用
4. 后面的线程启动、中断、终止和对象的终结和这里完全没有关系，因此这些规则也是不适用的
5. 没有一条happens-before适用，因此传递性规则也不适用

在这里，虽然线程A在时间上先于线程B执行，但是由于代码完全不适用happens-before规则，因此我们无法确定先B收到的值是多少。也就是说上面代码是线程不安全的。

对于上面代码，那我们如何修复线程不安全这个问题呢？这里，我们只要满足happens-before规则中2、3的任意一种规则就可以了。即要么把setter/getter方法定义为synchronized方法，要么在变量a上加volatile修饰符。

通过上面的例子，我们可以得出结论：一个操作“时间上的先发生”不代表这个操作会happens-before其它操作。那一个操作happens-before其它操作，是否就表示这个操作是“时间上先发生”的呢？答案也是**否定的**，我们来看看下面一个示例：

```java
int i = 1;
int m = 2;
```

上面两个赋值操作在同一个线程中，根据程序顺序性规则，“int i = 1;"这个操作happens-before ”int m = 2;“这个操作，但是”int m = 2;“这个操作完全有可能被处理器先执行，这并不影响happens-before原则的正确性。因为这种重排序在JMM中是允许的。

最后我们得出的结论是：时间先后顺序与happens-before原则之间基本没有太大的关系，所以我们在衡量并发安全问题的时候不要受到时间顺序的干扰，一切必须以happens-before原则为准。
