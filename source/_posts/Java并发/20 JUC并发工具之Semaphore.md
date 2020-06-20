---
title: JUC并发工具之Semaphore源码解析
tags:
  - Java
  - 并发
  - Semaphore
copyright: true
categories:
  - Java并发编程
translate_title: semaphore-source-code-analysis-of-juc-concurrent-tool
special: JUC
original: true
show_title: juc-semaphore
date: 2019-09-20 13:15:36
---
Semaphore（信号量）是用来控制同时访问特定资源线程数量的工具。它通过协调各个线程，以保证合理的使用公共资源。以一个停车场的运作为例。为了简单起见，假设停车场只有三个车位，一开始三个车位都是空的。这时如果同时来了五辆车，看门人允许其中三辆不受阻碍的进入，然后放下车拦，剩下的车则必须在入口等待，后来的车也都不得不在入口处等待。这时，有一辆车离开停车场，看门人得知后，打开车拦，放入一辆，如果又离开两辆，则又可以放入两辆，如此往复。这个停车系统中，每辆车就好比一个线程，看门人就好比一个信号量，看门人限制了可以活动的线程。假如里面依然是三个车位，但是看门人改变了规则，要求每次只能停两辆车，那么一开始进入两辆车，后面得等到有车离开才能有车进入，但是得保证最多停两辆车。对于Semaphore类而言，就如同一个看门人，限制了可活动的线程数。

### 实现分析

semaphore结构如下：

![semaphore结构](http://cdn.zzwzdx.cn/blog/semaphore结构图.png&blog)

从上图我们可以看出，Semaphore包含了公平锁(FairSync)和非公平锁(NonfairSync)，而这两个内部类又都继承自内部类Sync，Sync又继承AQS(AbstractQueuedSynchronizer)。

Semaphore提供了两个构造方法，分别是：

* public Semaphore(int permits)：使用给定的许可数量和非公平模式创建Semaphore。
* public Semaphore(int permits, boolean fair)：使用给定的许可数量和公平性模式创建Semaphore。

实现代码如下：

```java
/**
 * 默认创建一个非公平锁
 * @param  permits [许可数量]
 * @return         [创建Semaphore]
 */
public Semaphore(int permits) {
    sync = new NonfairSync(permits);
}

/**
 * 根据fair创建公平或者非公平锁
 * @param  permits [许可数量]
 * @param  fair    [公平性,true：公平；false：非公平]
 * @return         [创建Semaphore]
 */
public Semaphore(int permits, boolean fair) {
    sync = fair ? new FairSync(permits) : new NonfairSync(permits);
}
```

Semaphore默认提供非公平锁，当permits的值设置为1时，Semaphore可以当排他锁使用。其中0和1就相当于它的状态，当等于1时表示其他线程可以获取，当等于0时，排他，即其他线程必须要等待。

### 信号量获取

Semaphore提供了`acquire()`方法来获取一个许可，其定义如下：

```java
/**
 * 从信号量(semaphore)中获取一个许可
 * @throws InterruptedException [description]
 */
public void acquire() throws InterruptedException {
    sync.acquireSharedInterruptibly(1);
}
```

内部调用了AQS的`acquireSharedInterruptibly(int arg)`方法,该方法以共享模式获取同步状态。其定义如下：

```java
public final void acquireSharedInterruptibly(int arg) throws InterruptedException {
    //判断线程是否被中断，如果中断，则抛出中断异常
    if (Thread.interrupted())
        throw new InterruptedException();
    //尝试获取锁，如果获取失败即返回的结果为-1，则执行doAcquireSharedInterruptibly方法
    if (tryAcquireShared(arg) < 0)
        doAcquireSharedInterruptibly(arg);
}
```

在acquireSharedInterruptibly(int arg) 方法中，tryAcquireShared(arg)是由子类实现，对于Semaphore而言，如果我们选择了公平模式，则调用FairSync的tryAcquireShared(int acquires)，如果我们选择了非公平模式，则调用NonfairSync的tryAcquireShared(int acquires)方法。

###  公平

```java
protected int tryAcquireShared(int acquires) {
    for (;;) {
        //判断等待队列中的头结点是否是当前线程，即是否有线程等待获取锁的时间比当前线程更长，如果有则返回-1
        if (hasQueuedPredecessors())
            return -1;
        //获取当前信号量许可(获取AQS中state的值)
        int available = getState();
        //许可数减去acquires后，剩余的信号量许可
        int remaining = available - acquires;
        //当剩余许可量小于0或者CAS设置剩余许可量成功,则返回剩余许可量
        if (remaining < 0 ||
            compareAndSetState(available, remaining))
            return remaining;
    }
}
```

###  非公平

```java
protected int tryAcquireShared(int acquires) {
    return nonfairTryAcquireShared(acquires);
}

final int nonfairTryAcquireShared(int acquires) {
    for (;;) {
        //获取当前信号量许可
        int available = getState();
         //许可数减去acquires后，剩余的信号量许可
        int remaining = available - acquires;
        //当剩余许可量小于0或者CAS设置剩余许可量成功,则返回剩余许可量
        if (remaining < 0 ||
            compareAndSetState(available, remaining))
            return remaining;
    }
}
```

对比公平和非公平获取信号量的源码，我们可以放心，公平获取信号量许可仅仅是多了检查是否有线程等待的时间比当前线程更长。其它的没有任何区别。

### 信号量释放

当获取了信号量许可，使用完毕后，需要释放。Semaphore提供了`release()`方法来释放许可，其定义如下：

```java
public void release() {
    sync.releaseShared(1);
}
```

该方法内部调用了AQS的releaseShared(int arg)方法，其定义如下：

```java
public final boolean releaseShared(int arg) {
    if (tryReleaseShared(arg)) {
        doReleaseShared();
        return true;
    }
    return false;
}
```

该方法实际调用了Semaphore内部类Sync的tryReleaseShared(arg)方法，其定义如下：

```java
protected final boolean tryReleaseShared(int releases) {
    for (;;) {
        //获取当前许可
        int current = getState();
        //当前许可数加上要释放的许可数量
        int next = current + releases;
        if (next < current) // overflow
            throw new Error("Maximum permit count exceeded");
        //CAS设置许可量为next   
        if (compareAndSetState(current, next))
            return true;
    }
}
```

信号量的获取和释放的详细过程，请看作者前面的AQS系列文章。

### 应用实例

我们以最开始停车场的例子，来看看Semaphore的使用。

```java
public class SemaphoreDemo {
    static class Parking {
        //信号量
        private Semaphore semaphore;

        Parking(int count) {
            semaphore = new Semaphore(count);
        }

        public void park() {
            try {
                //获取信号量
                semaphore.acquire();
                Random random = new Random();
                int time = random.nextInt(10);
                System.out.println(Thread.currentThread().getName() + "进入停车场，停车" + time + "秒...");
                Thread.sleep(time);
                System.out.println(Thread.currentThread().getName() + "离开停车场...");
            } catch (InterruptedException e) {
                e.printStackTrace();
            } finally {
                semaphore.release();
            }
        }
    }


    static class Car extends Thread {
        Parking parking;

        Car(Parking parking) {
            this.parking = parking;
        }

        @Override
        public void run() {
            parking.park(); //进入停车场
        }
    }

    public static void main(String[] args) {
        Parking parking = new Parking(3);

        for (int i = 0; i < 5; i++) {
            new Car(parking).start();
        }
    }
}
```

### 小结

Semaphore的分析到此结束，是不是非常的简单呢？
