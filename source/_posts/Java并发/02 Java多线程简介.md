---
title: Java多线程简介
tags:
  - Java
  - 线程
copyright: true
categories:
  - Java并发编程
translate_title: introduction-to-java-multithreading
show_title: java-multithreading-introduction
date: 2019-05-11 18:22:30
special: JUC
original: true
---

多线程在Java程序中无处不在，在上一篇（[Java线程概念理解](http://zzwzdx.cn/java-thread/)）中我们看到就算是一个最简单的Java类中也涉及到了多线程，大家可能会疑惑，为什么一个这么简单的Java类中，却启动了那么多“无关”的线程，Java是不是将简单的问题搞复杂了呢？答案当然是否定了，这是因为正确的使用多线程能够将耗时的处理大大的缩减时间，能够让用户的体验更加友好。使用多线程的主要原因有以下几点：

1. 更多的处理器核心

现代处理器的核数越来越多，以及多线程越来越广泛的使用，现代计算机越来越擅长并行计算。我们知道一个程序作为一个进程在运行，而一个进程可以创建多个线程，而一个线程在一个时刻只能运行在一个处理器核心上，试想一下一个单线程程序在运行时只能使用一个处理器核心，而再多的处理器核心也无法提升该程序的执行效率。

2. 更快的响应时间

多线程能够给用户更快的响应时间，例如我们在做一些复杂的业务逻辑的时候，我们先可以给用户一个反馈，然后再将一些数据一致性不强的业务逻辑派发给其它线程去处理，这样一来就大大缩短了响应时间，提升了用户体验。

3. 更好的编程模型

Java为多线程提供了良好的编程模型，使开发者能够更加专注于问题的解决，即为所遇到的问题建立合适的模型，而不是绞尽脑汁的如何将其多线程化。

###  线程优先级


线程优先级从低到高依次为1~10，在创建线程是可以使用`setPriority(int newPriority)`方法来设置线程等的优先级，默优先级位是5。线程的优先级控制的是线程获取时间片段的多少，也就是说优先级高的线程分配时间片的数量多于优先级低的线程。但是这也不是绝对的，因为不同的JVM和操作系统上，线程的规划会存在着差异，有些操作系统甚至会忽略线程优先级的设置，因此不要将线程的优先级作为线程的运行顺序以及程序的正确性的依赖。

### 线程优先级设置

线程优先级在Thread类中的定义如下：

```java
/**
 * 线程可以拥有的最小优先级
 */
public final static int MIN_PRIORITY = 1;

/**
 * 分配个线程的默认优先级
 */
public final static int NORM_PRIORITY = 5;

/**
 * 线程可以拥有的最大优先级
 */
public final static int MAX_PRIORITY = 10;


public final void setPriority(int newPriority) {
    //线程组
    ThreadGroup g;
    checkAccess();
    //优先级范围检查
    if (newPriority > MAX_PRIORITY || newPriority < MIN_PRIORITY) {
        throw new IllegalArgumentException();
    }
    if ((g = getThreadGroup()) != null) {
        if (newPriority > g.getMaxPriority()) {
            newPriority = g.getMaxPriority();
        }
        //设置线程优先级
        setPriority0(priority = newPriority);
    }
}

// 最终调用本地方法设置优先级
private native void setPriority0(int newPriority);
```

接下来我们看下线程优先级的特性：

- **线程优先级的继承性**：如果一个线程A启动了线程B，那么线程B的优先级将会和线程A 的一致（线程B不显示的设置线程优先级）。
- **线程优先级的随机性**：优先级高的线程并不一定会先于优先级低的线程执行。

下面我们来验证下线程优先级的这些特性：

```java
public class ThreadPriority {
    public static void main(String[] args) {
        Thread1 t1 = new Thread1();
        t1.start();
        System.out.println("main的线程优先级：" + Thread.currentThread().getPriority());
    }
}

class Thread1 extends Thread {
    @Override
    public void run() {
        System.out.println(Thread.currentThread().getName() + "优先级：" + Thread.currentThread().getPriority());
    }
}
output:
main的线程优先级：5
Thread-0优先级：5
```

```java
public class ThreadPriority {
    public static void main(String[] args) {

        for (int i = 1; i <= 10; i++) {

            PriorityThread t = new PriorityThread("线程优先级" + i);
            t.setPriority(i);
            t.start();

        }
    }
}

class PriorityThread extends Thread {
    public PriorityThread(String name) {
        super(name);
    }

    @Override
    public void run() {
        System.out.println(Thread.currentThread().getName() + "开始执行....");
        long beginTime = System.currentTimeMillis();
        long addResult = 0;
        for (int j = 0; j < 10; j++) {
            for (int i = 0; i < 50000; i++) {
                Random random = new Random();
                random.nextInt();
                addResult = addResult + i;
            }
        }
        long endTime = System.currentTimeMillis();
        System.out.println("☆☆☆☆☆" + Thread.currentThread().getName() + " use time=" + (endTime - beginTime));
    }
}
output:
线程优先级9开始执行....
线程优先级10开始执行....
线程优先级7开始执行....
线程优先级8开始执行....
线程优先级5开始执行....
线程优先级6开始执行....
线程优先级4开始执行....
线程优先级3开始执行....
☆☆☆☆☆线程优先级10 use time=157
线程优先级2开始执行....
☆☆☆☆☆线程优先级9 use time=226
☆☆☆☆☆线程优先级7 use time=273
☆☆☆☆☆线程优先级8 use time=274
☆☆☆☆☆线程优先级5 use time=354
☆☆☆☆☆线程优先级6 use time=369
线程优先级1开始执行....
☆☆☆☆☆线程优先级3 use time=572
☆☆☆☆☆线程优先级4 use time=580
☆☆☆☆☆线程优先级1 use time=223
☆☆☆☆☆线程优先级2 use time=455

output:
线程优先级7开始执行....
线程优先级8开始执行....
线程优先级9开始执行....
线程优先级10开始执行....
线程优先级5开始执行....
☆☆☆☆☆线程优先级9 use time=170
☆☆☆☆☆线程优先级10 use time=185
线程优先级6开始执行....
☆☆☆☆☆线程优先级7 use time=206
☆☆☆☆☆线程优先级8 use time=228
线程优先级1开始执行....
☆☆☆☆☆线程优先级5 use time=262
线程优先级3开始执行....
☆☆☆☆☆线程优先级6 use time=84
线程优先级2开始执行....
线程优先级4开始执行....
☆☆☆☆☆线程优先级4 use time=95
☆☆☆☆☆线程优先级3 use time=112
☆☆☆☆☆线程优先级2 use time=135
☆☆☆☆☆线程优先级1 use time=230
```

从上面2个例子，我们就验证了线程优先级的继承性和随机性。

### 2、线程状态


Java线程在运行的生命周期中可能处于以下几种状态，在给定的时刻，线程只能处于其中一种状态。线程状态如下：

1. **NEW**：初始状态，线程被构建，但是还没有调用start()方法。
2. **RUNNABLE**：运行状态，Java线程将操作系统中**就绪**和**运行**两种状态笼统的称作**运行中**。
3. **BLOCKED**：阻塞状态，表示线程阻塞于锁。
4. **WAITING**：等待状态，表示线程进入等待状态，进入该状态表示当前线程需要等待其他线程做出一些特定动作（通知或中断）
5. **TIME_WAITING**：超时等待状态，该状态不同于WAITING，它是可以在指定的时间自行返回的。
6. **TERMINATED**：终止状态，表示当前线程已经执行完毕。

我们用一个示例来深入的理解现在的状态，示例代码如下：

```java
public class ThreadState {
    public static void main(String[] args) {

        new Thread(new TimeWaiting(), "TimeWaitingThread").start();
        new Thread(new Waiting(), "WaitingThread").start();

        // 使用两个Blocked线程，一个获取锁成功，另一个被阻塞
        new Thread(new Blocked(), "BlockedThread-1").start();
        new Thread(new Blocked(), "BlockedThread-2").start();
    }

    // 该线程不断地进行睡眠
    static class TimeWaiting implements Runnable {
        @Override
        public void run() {
            while (true) {
                try {
                    SECONDS.sleep(100);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }
    }
    // 该线程在Waiting.class实例上等待
    static class Waiting implements Runnable {
        @Override
        public void run() {
            while (true) {
                synchronized(Waiting.class) {
                    try {
                        Waiting.class.wait();
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                }
            }
        }
    }
    // 该线程在Blocked.class实例上加锁后，不会释放该锁
    static class Blocked implements Runnable {
        public void run() {
            synchronized(Blocked.class) {
                while (true) {
                    try {
                        SECONDS.sleep(100);
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                }
            }
        }
    }
}
```

打开终端，输入“jps”,输出如下：
C:\Users\Administrator>jps
15680 Jps
16160 ThreadState
10772
15492 Launcher
3196 Launcher

可以看到运行示例对应的进程ID是16160，接着在输入“jstack 16160”,部分输入如下

```java
C:\Users\Administrator>jstack 16160

// BlockedThread-2 线程阻塞在获取Blocked.class示例的锁上
"BlockedThread-2" #14 prio=5 os_prio=0 tid=0x0000000019399000 nid=0x1dec waiting for monitor entry [0x000000001a00f000]
  java.lang.Thread.State: BLOCKED (on object monitor)
        at com.zzw.juc.thread.ThreadState$Blocked.run(ThreadState.java:54)
        - waiting to lock <0x00000000d87c86a0> (a java.lang.Class for com.zzw.juc.thread.ThreadState$Blocked)
        at java.lang.Thread.run(Thread.java:748)

//  BlockedThread-1线程获取到了Blocked.class的锁
"BlockedThread-1" #13 prio=5 os_prio=0 tid=0x0000000019394000 nid=0x3e58 waiting on condition [0x0000000019f0f000]
   java.lang.Thread.State: TIMED_WAITING (sleeping)
        at java.lang.Thread.sleep(Native Method)
        at java.lang.Thread.sleep(Thread.java:340)
        at java.util.concurrent.TimeUnit.sleep(TimeUnit.java:386)
        at com.zzw.juc.thread.ThreadState$Blocked.run(ThreadState.java:54)
        - locked <0x00000000d87c86a0> (a java.lang.Class for com.zzw.juc.thread.ThreadState$Blocked)
        at java.lang.Thread.run(Thread.java:748)

 // WaitingThread线程在Waiting实例上等待
"WaitingThread" #12 prio=5 os_prio=0 tid=0x00000000193a0000 nid=0x3ed0 in Object.wait() [0x0000000019e0f000]
   java.lang.Thread.State: WAITING (on object monitor)
        at java.lang.Object.wait(Native Method)
        - waiting on <0x00000000d87c5910> (a java.lang.Class for com.zzw.juc.thread.ThreadState$Waiting)
        at java.lang.Object.wait(Object.java:502)
        at com.zzw.juc.thread.ThreadState$Waiting.run(ThreadState.java:40)
        - locked <0x00000000d87c5910> (a java.lang.Class for com.zzw.juc.thread.ThreadState$Waiting)
        at java.lang.Thread.run(Thread.java:748)

 // TimeWaitingThread线程处于超时等待
"TimeWaitingThread" #11 prio=5 os_prio=0 tid=0x0000000019393000 nid=0x38d8 waiting on condition [0x0000000019d0e000]
   java.lang.Thread.State: TIMED_WAITING (sleeping)
        at java.lang.Thread.sleep(Native Method)
        at java.lang.Thread.sleep(Thread.java:340)
        at java.util.concurrent.TimeUnit.sleep(TimeUnit.java:386)
        at com.zzw.juc.thread.ThreadState$TimeWaiting.run(ThreadState.java:27)
        at java.lang.Thread.run(Thread.java:748)

```

通过上面的示例，我们大概了解了Java程序运行中线程状态的具体含义。线程在自身的生命周期中，并不是固定地处于某个状态，而是随着代码的执行在不同的状态之间进行切换，Java线程状态变迁如下图所示：
![Java线程状态](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/Java线程状态.png)

从上图我们可以看到，线程创建后调用start()方法开始执行。当线程执行了waite()方法之后，线程进入了等待状态，进入到等待状态的线程需要其它线程的通知才能返回到运行状态。超时等待状态相当于在等待状态上增加了超时时间的限制，也就是说当超时时间到达是线程会从超时等待状态返回到运行状态。当线程在竞争锁失败时，会进入阻塞状态，当阻塞状态的线程竞争锁成功时，将进入运行状态。线程在执行完run()方法之后进入终止状态。
**注意：** 这里说的竞争锁失败，是线程在进入synchronized关键字修饰的方法或者代码。而不是java并发包下的Lock接口实现的锁。在Lock锁竞争失败，线程进入的是等待状态，因为java并发包中Lock接口对于阻塞的实现均使用了LockSupport类中的相关方法。

### 3 Deamon线程

Deamon线程是一种支持型线程，它主要被用作程序中后台调度已经支持性工作。Deamon线程在主线程结束后将被直接关闭。可以通过Thread.setDaemon(true)方法将线程转换为Deamon线程。设置Deamon属性必须在线程启动之前设置，线程启动后设置的Deamon属性将不起作用。
