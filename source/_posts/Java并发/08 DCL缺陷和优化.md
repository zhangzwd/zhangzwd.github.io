---
title: DCL缺陷和优化
tags:
  - Java
  - 线程
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: dcl-defects-and-optimization
show_title: dcl-defects-and-optimization
date: 2019-07-12 16:05:00
original: true
---

#### <font color="#EE30A7">DCL的问题</font>

单利模式是我们经常用到的一种模式，但是要正确的书写和理解一个单利模式却没有那么简单，首先我们看看下面的代码示例：

```java
public class SignalTest {
    private static SignalTest instance  = null;
    private SignalTest(){}

    public static SignalTest getInstance(){
        if(instance == null) {
            instance = new SignalTest();
        }
        return instance;
    }
}
```

上面代码看似没有问题，但是有一个致命的缺陷，那就是这段代码是线程不安全的。在多线程中，如果对个线程同时执行`if(instance == null) `，那么将会得到多个不同的`instance`。我们将上面代码加锁优化，得到如下代码： 

```java
public class SignalTest {
    private static SignalTest instance  = null;
    private SignalTest(){}

    public synchronized static SignalTest getInstance(){
        if(instance == null) {
            instance = new SignalTest();
        }
        return instance;
    }
}
```

使用synchronized修饰getInstance()方法，这样在多线程中虽然能够实现单利，但是synchronized会导致性能开销，如果多个线程频繁的调用getInstance()方法，将会导致程序的性能下降。为了解决性能问题，我们继续优化上述代码，示例如下：

```java
public class SignalTest {
    private static SignalTest instance  = null;
    private SignalTest(){}

    public static SignalTest getInstance(){
        if(instance == null) {
            synchronized (SignalTest.class) {
                if(instance == null) {
                    instance = new SignalTest();
                }
            }
        }
        return instance;
    }
}
```

如上面代码所示，如果第一次检查instance不为null,则不需要执行下面的加锁和初始化操作，因此可以大幅度降低

synchronized带来的性能开销。上面的代码看似很完美，但是却有一个致命的缺陷，那就是初始化对象并不是一个原子操作，`instance = new SignalTest();`可以分为以下3步完成：

```java
memory = allocate(); // 1:分配对象的内存空间
ctorInstance(memory); // 2:初始化对象
instance = memory; // 3: 设置instance指向刚分配的内存地址
```

上面3行代码中，2和3可能被重排序，如果2和3被重排序，那么上述DCL代码在多线程中执行的时序如下：

![image](http://www.wailian.work/images/2019/05/22/DCL.png)

从上图我们可以看到，当线程A执行到操作3之后，操作2之前时，这时候线程B首次判断instance是否为null,这个时候我们知道instance是不为空的，但是instance却根本不能使用，因为对象还没有被初始化。这就是DCL缺陷的所在。

#### <font color="#EE30A7">DCL解决方案</font>

在知道了上面DCL的缺陷的根源之后，那我们就知道了应该如何来解决DCL的问题，我们有2种方案来解决。

1. 禁止2和3重排序
2. 允许2和3进行重排序，但是不允许其它线程看到这个重排序

下面，我们分别来介绍上面2中解决方案

##### <font color="#EE30A7">volatile解决方案</font>

根据LZ前面的博客，我们知道想要禁止2和3重排序，只需要在instance变量前加volatile关键词修饰即可。代码如下：

```java
public class SignalTest {
    private volatile static SignalTest instance  = null;
    private SignalTest(){}

    public static SignalTest getInstance(){
        if(instance == null) {
            synchronized (SignalTest.class) {
                if(instance == null) {
                    instance = new SignalTest();
                }
            }
        }
        return instance;
    }
}
```

当声明对象的引用为volatile后，初始化对象的3行代码中2和3的重排序将会在多线程环境中被禁止。

##### <font color="#EE30A7">类初始化解决方案</font>

JVM在类初始化阶段，会执行类的初始化。在类初始化阶段，JVM会获取一个锁。这个锁可以同步多个线程对同一个类的初始化。基于这个特性，我们可以用静态方法的模式来正确的使用单利，代码如下：

```java
public class InstanceFactory {
    private static class InstanceFactoryHolder{
        public static InstanceFactory instanceFactory = new InstanceFactory();
    }
    public static InstanceFactory getInstance(){
        return InstanceFactoryHolder.instanceFactory; // 这里导致InstanceFactoryHolder类初始化
    }
}
```

如果这时候有多个线程同时访问getInstance()方法，这是某一个线程会导致InstanceFactoryHolder类的初始化，因此最终只会有一个线程执行new InstanceFactory()，因此无论new InstanceFactory()中是否存在排序，它对其它的线程不可见。其执行流程如下图所示：

![image](http://www.wailian.work/images/2019/05/27/image.png)

#####  <font color="#EE30A7">类的初始化</font>

根据Java虚拟机规范，我们知道以下几种情况，类会被立即初始化。

1. 遇到new、getstatic、putstatic或者invokestatic这4条字节指令时，如果类没有被初始化过，则需要先触发其初始化。生成这4条指令的常用场景有：使用new关键词实例化对象的时候、设置或读取一个静态的时候以及调用一个类的静态方法的时候。
2. 使用java.lang.reflect包的方法对类进行反射调用的时候，如果类没有被初始化过，则需要先触发其初始化。
3. 当初始化一个类时，如果发现其父类还没有被初始化，则需要先触发其父类的初始化。
4. 当虚拟机启动时，用户需要指定执行一个主类，虚拟机会先初始化这个主类。
5. 当使用JDK1.7动态语言支持时，如果一个java.lang.invoke.MethodHandle实例最后的解析结果是REF_getStatic、REF_putStatic、RER_invokeStatic的方法句柄时，并且这个方法句柄所对应的类没有被实例化，则需要先触发其初始化。

Java语言规范规定，对于每个类或者接口C，都有唯一的初始化锁LC与之对应。从C到LC的映射，由JVM具体实现去自由实现。JVM在类初始化期间会获取这个初始化锁，并且每个线程至少获取一次锁来保证这类已经被初始化过了。初始化C的过程如下：

1. 同步C的初始化锁LC。这个操作会导致当前线程一直等待，知道可以获取LC锁。
2. 若果C的Class对象显示当前C的初始化是由其它线程正在进行的，那么当前线程就释放LC并进入阻塞状态，直到它知道初始化工作已经由其它线程完成，此时当前线程需要重试这一过程。
3. 若果C的Class对象显示C的初始化正有当前线程进行，那么表明这是对初始化的递归操作。释放LC并正常返回。
4. 如果C的Class对象显示Class已经初始化完成，那么就不需要做什么了，释放LC并正常返回。
5. 若果C的Class对象显示它处于一个错误的状态，那就不可能再被初始化了。释放LC并抛出NoClassDefFoundError异常。
6. 否则，记录下当先线程正在初始化C的Class对象，随后释放LC。根据属性出现在ClassField的顺序，利用ConstantValue属性来初始化C中的每个final static字段。
7. 接下来，如果C是类而不是接口，并且它的父类SC还没有初始化，那么就在SC上面也递归的进行完整的初始化过程。
8. 之后，通过查询C的定义加载器来判定C是否开启了断言机制。
9. 执行C的类或接口的初始化。
10. 若果正常执行了类或接口的初始化方法，那就获取LC，并把C的Class对象标记成已完成完全初始化，通知所有正在等待的线程，接着释放LC，正常的退出整个过程。
11. 否则，类或接口的初始化方法就必定因为抛出了一个异常而中断退出。若果E不是Error或它的某个子类，那就以E为参数来创建一个新的ExceptionInInitializerError实例，并在之后的步骤中，用改实例来代替E。
12. 获取LC，标记下C的Class对象有错误发生，通知所有正在等待的线程，释放LC，将E或上一步中具体错误对象作为此次意外中断的原因。

结合上述C的初始化过程，我们可以看到InstanceFactory示例的执行时序图如下：

![image](http://www.wailian.work/images/2019/05/27/imageaf25e.png)