---
title: 深入分析volatile实现原理
tags:
  - Java
  - 线程
  - volatile
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: in-depth-analysis-of-volatile-implementation-principle
show_title: volatile-implementation
original: true
date: 2019-06-06 10:02:45
---

在前面一文中我们深入的分享了synchronized的实现原理，也知道了synchronized是一把重量级的锁。在Java中还有一个关键词，那就是volatile。volatile是轻量级的synchronized，它在多线程中保证了变量的“可见性”。可见性的意思是当一个线程修改了一个变量的值后，另外的线程能够读取到这个变量修改后的值。volatile在Java语言规范中的定义如下：

> Java编程语言允许线程访问共享变量，为了确保共享变量能够被准确和一致性的更新，线程应该确保通过排他锁单独获取这个变量。

这句话可能说的比较绕，我们先来看一段代码：

```java
public class VolatileTest implements Runnable {
    private boolean flag = false;
    @Override
    public void run() {
        while (!flag){
            
        }
        System.out.println("线程结束运行...");
    }
    public void setFlag(boolean flag) {
        this.flag = flag;
    }
    public static void main(String[] args) throws InterruptedException {
        VolatileTest v = new VolatileTest();
        Thread t1 = new Thread(v);
        t1.start();
        Thread.sleep(2000);
        v.setFlag(true);
    }
}
```

这段代码的运行结果：

![volatile测试结果](http://cdn.zzwzdx.cn/blog/volatile测试结果.png&blog)

可以看到尽管在代码中调用了v.setFlag(false)方法，线程也没有结束运行。这是因为在上面的代码中，实际上是有2个线程在运行，一个是main线程，一个是在main线程中创建的t1线程。因此我们可以看到在线程中的变量是互不可见的。  要理解线程中变量的可见性，我们需要先理解Java的内存模型。

### Java内存模型


在Java中，所有的实例域、静态变量和数组元素都存储在堆内存中，堆内存在线程之间是共享的。局部变量，方法定义参数和异常数量参数是存放在Java虚拟机栈上面的。Java虚拟机栈是线程私有的因此不会在线程之间共享，它们不存在内存可见性的问题，也不受内存模型的影响。

Java内存模型（Java Memory Model 简称 JMM），决定一个一个线程对共享变量的写入何时对其它线程可见。JMM定义了线程和主内存之间的抽象关系：

> 线程之间共享变量存储在主内存中，每个线程都有一个私有的本地内存，本地内存中存储了该线程共享变量的副本。本地内存是JMM的一个抽象概念，并不真实的存在。它涵盖了缓存、寄存器以及其他的硬件和编译优化。

Java内存模型的抽象概念图如下所示：

![Java内存模型](http://cdn.zzwzdx.cn/blog/Java内存模型.png&blog)

看完了Java内存模型的概念，我们再来看看内存模型中主内存是如何和线程本地内存之间交互的。

###  主内存和本地内存间的交互

主内存和本地内存的交互即一个变量是如何从主内存中拷贝到本地内存又是如何从本地内存中回写到主内存中的实现，Java内存模型提供了8种操作来完成主内存和本地内存之间的交互。它们分别如下：

* `lock（锁定）`：作用于主内存的变量，它把一个变量标识为一条线程独占的状态。
* `unlock（解锁）`：作用于主内存的变量，它把一个处于锁定状态的变量释放出来，释放后的变量才能被其它线程锁定。
* `read（读取）`：作用于主内存的变量，它把一个变量从主内存传输到线程的本地内存中，以便随后的load动作使用。
* `load（载入）`：作用于本地内存的变量，它把read操作从主内存中得到的变量值放入本地内存的变量副本中。
* `use（使用）`：作用于本地内存的变量，它把本地内存中一个变量的值传递给执行引擎，每当虚拟机遇到一个需要使用到变量值的字节码指令时将会执行这个操作。
* `assign（赋值）`：作用于本地内存的变量，它把一个从执行引擎接收到的变量赋予给本地内存的变量，每当虚拟机遇到一个给变量赋值的字节码指令时将会执行这个操作。
* `store（存储）`：作用于本地内存的变量，它把本地内存中的变量的值传递给主内存中，以便后面的write操作使用。
* `write（写入）`：作用于主内存的变量，它把store操作从本地内存中得到的变量的值放入主内存的变量中。

从上面8种操作中，我们可以看出，当一个变量从主内存复制到线程的本地内存中时，需要顺序的执行read和load操作，当一个变量从本地内存同步到主内存中时，需要顺序的执行store和write操作。Java内存模型只要求上述的2组操作是顺序的执行的，但并不要求连续执行。比如对主内存中的变量a 和 b 进行访问时，有可能出现的顺序是read a read b load b load a。除此之外，Java内存模型还规定了在执行上述8种基本操作时必须满足以下规则：

* 不允许read和load，store和write操作单独出现，这2组操作必须是成对的。

* 不允许一个线程丢弃它最近的assign操作。即变量在线程的本地内存中改变后必须同步到主内存中。

* 不允许一个线程无原因的把数据从线程的本地内存同步到主内存中。

* 不允许线程的本地内存中使用一个未被初始化的变量。

* 一个变量在同一时刻只允许一个线程对其进行lock操作，但是一个线程可以对一个变量进行多次的lock操作，当线程对同一变量进行了多次lock操作后需要进行同样次数的unlock操作才能将变量释放。

* 如果一个变量执行了lock操作，则会清空本地内存中变量的拷贝，当需要使用这个变量时需要重新执行read和load操作。

* 如果一个变量没有执行lock操作，那么就不能对这个变量执行unlock操作，同样也不允许unlock一个被其它线程执行了lock操作的变量。也就是说lock 和unlock操作是成对出现的并且是在同一个线程中。

* 对一个变量执行unlock操作之前，必须将这个变量的值同步到主内存中去。

###  volatile 内存语义之可见性

大概了解了Java的内存模型后，我们再看上面的代码结果我们将很好理解为什么是这样子的了。首先主内存中flag的值是false，在t1线程执行时，依次执行的操作有read、load和use操作，这个时候t1线程的本地内存中flag的值也是false，线程会一直执行。当main线程调用v.setFlag(true)方法时，main线程中的falg被赋值成了true,因为使用了assign操作，因此main线程中本地内存的flag值将同步到主内存中去，这时主内存中的flag的值为true。但是t1线程没有再次执行read 和 load操作，因此t1线程中flag的值仍然是false，所以t1线程不会终止运行。想要正确的停止t1线程，只需要在flag变量前加上volatile修饰符即可，因为volatile保证了变量的可见性。既然volatile在各个线程中是一致的，那么volatile是否能够保证在并发情况下的安全呢？答案是否定的，因为volatile不能保证变量的原子性。示例如下：

```java
public class VolatileTest2 implements Runnable {
    private volatile int i = 0;
    @Override
    public void run() {
        for (int j=0;j<1000;j++) {
            i++;
        }
    }
    public int getI() {
        return i;
    }

    public static void main(String[] args) throws InterruptedException {
        VolatileTest2 v2 = new VolatileTest2();
        for (int i=0;i<100;i++){
            new Thread(v2).start();
        }
        Thread.sleep(5000);
        System.out.println(v2.getI());
    }
}
```

这段代码启动了100线程，每个线程都对i变量进行1000次的自增操作，如果这段代码能够正确的运行，那么正确的结果应该是100000，但是实际并非如此，实际运行的结果是少于100000的，这是因为volatile不能保证i++这个操作的原子性。我们用javap反编译这段代码，截取run()方法的代码片段如下：

```java
 public void run();
    descriptor: ()V
    flags: ACC_PUBLIC
    Code:
      stack=3, locals=2, args_size=1
         0: iconst_0
         1: istore_1
         2: iload_1
         3: sipush        1000
         6: if_icmpge     25
         9: aload_0
        10: dup
        11: getfield      #2                  // Field i:I
        14: iconst_1
        15: iadd
        16: putfield      #2                  // Field i:I
        19: iinc          1, 1
        22: goto          2
        25: return

```

我们发现i++虽然只有一行代码，但是在Class文件中却是由4条字节码指令组成的。从上面字节码片段，我们很容易分析出并发失败的原因：当getfield指令把变量i的值取到操作栈时，volatile关键字保证了i的值在此时的正确性，但是在执行iconst_1和iadd指令时，i的值可能已经被其它的线程改变，此时再执行putfield指令时，就会把一个过期的值回写到主内存中去了。由于volatile只保证了变量的可见性，在不符合以下规则的场景中，我们仍然需要使用锁来保证并发的正确性。

* 运算结果结果并不依赖变量的当前值，或者能够确保只有单一的线程修改了变量的值
* 变量不需要与其他的状态变量共同参与不变约束



###  volatile 内存语义之禁止重排序

在介绍volatile的禁止重排序之前，我们先来了解下什么是重排序。重排序是指编译器和处理器为了优化程序性能而对指令进行重新排序的一种手段。那么重排序有哪些规则呢？不可能任何代码都可以重排序，如果是这样的话，那么在单线程中，我们将不能得到明确的知道运行的结果。重排序规则如下：

* 具有数据依赖性操作不能重排序，数据依赖性是指两个操作访问同一个变量，如果一个操作是写操作，那么这两个操作就存在数据依赖性。
* as-if-serial语义，as-if-serial语义的意思是，不管怎么重排序，单线程的程序执行结果是不会改变的。

既然volatile禁止重排序，那是不是重排序对多线程有影响呢？我们先来看下面的代码示例

```java
public class VolatileTest3 {
    int a = 0;
    boolean flag = false;

    public void write(){
        a = 1;                 // 1
        flag = true;           // 2
    }

    public void read(){
        if(flag){               // 3
            int i = a*a;        // 4
            System.out.println("i的值为："+i);
        }

    }
}
```

此时有2个线程A和B，线程A先执行write()方法，虽有B执行read()方法，在B线程执行到第4步时，i的结果能正确得到吗？结论是 **不一定**  ，因为步骤1和2没有数据依赖关系，因此编译器和处理器可能对这2个操作进行重排序。同样步骤3和4也没有数据依赖关系，编译器和处理器也可以对这个2个操作进行重排序，我们来看看这两种重排序带来的效果：

![线程重排序](http://cdn.zzwzdx.cn/blog/线程重排序.png&blog)

从上面图片，这2组重排序都会破坏多线程的运行结果。了解了重排序的概念和知道了重排序对多线程的影响后，我们知道了volatile为什么需要禁止重排序，那JMM到底是如何实现volatile禁止重排序的呢？下面我们就来探讨下JMM是如何实现volatile禁止重排序的。

前面提到过，重排序分为编译器重排序和处理器重排序，为了实现volatile内存语义，JMM分别对这两种重排序进行了限制。下图是JMM对编译器重排序指定的volatile规则：

![volatile规则](http://cdn.zzwzdx.cn/blog/volatile规则.png&blog)

从上面图中我们可以分析出：

* 当第一个操作为volatile读时，无能第二个操作是什么，都不允许重排序。这个规则确保了volatile读之后的操作不能重排序到volatile读之前。
* 当第二个操作为volatile写时，无论第一个操作是什么，都不允许重排序。这个规则确保了volatile写之前的操作不能重排序到volatile写之后。
* 当第一个操作是volatile写，第二个操作是volatile读时，不允许重排序。

 为了实现volatile内存语义，编译器在生成字节码时，会在指令序列中插入内存屏障来禁止特定类型处理器的重排序，在JMM中，内存屏障的插入策略如下：

* 在每个volatile写操作之前插入一个StoreStore屏障
* 在每个volatile写操作之后插入一个StoreLoad屏障
* 在每个volatile读操作之后插入一个LoadLoad屏障
* 在每个volatile读操作之后插入一个LoadStore屏障

StoreStore屏障可以保证在volatile写之前，前面所有的普通读写操作同步到主内存中

StoreLoad屏障可以保证防止前面的volatile写和后面有可能出现的volatile读/写进行重排序

LoadLoad屏障可以保证防止下面的普通读操作和上面的volatile读进行重排序

LoadStore屏障可以保存防止下面的普通写操作和上面的volatile读进行重排序

上面的内存屏障策略可以保证任何程序都能得到正确的volatile内存语义。我们以下面代码来分析

```java
public class VolatileTest3 {
    int a = 0;
    volatile boolean flag = false;

    public void write(){
        a = 1;                 // 1
        flag = true;           // 2
    }

    public void read(){
        if(flag){               // 3
            int i = a*a;        // 4
        }
    }
}
```

![内存屏障策略分析一](http://cdn.zzwzdx.cn/blog/内存屏障策略分析一.png&blog)

通过上面的示例我们分析了volatile指令的内存屏蔽策略，但是这种内存屏障的插入策略是非常保守的，在实际执行时，只要不改变volatile写/读的内存语义，编译器可以根据具体情况来省略不必要的屏障。如下示例：

```java
class VolatileBarrierExample {
	int a;
	volatile int v1 = 1;
	volatile int v2 = 2;
	void readAndWrite() {
		int i = v1; // 第一个volatile读
		int j = v2; // 第二个volatile读
		a = i + j; // 普通写
		v1 = i + 1; // 第一个volatile写
		v2 = j * 2; // 第二个 volatile写
	} 
}
```

上述代码，编译器在生成字节码时，可能做了如下优化

![内存屏障策略分析二](http://cdn.zzwzdx.cn/blog/内存屏障策略分析二.png&blog)
