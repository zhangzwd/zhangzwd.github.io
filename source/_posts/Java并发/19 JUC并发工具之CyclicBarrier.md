---
title: JUC并发工具之CyclicBarrier源码解析
tags:
  - Java
  - 并发
  - cyclicBarrier
copyright: true
categories:
  - Java并发编程
translate_title: source-code-analysis-of-cyclicbarrier-of-juc-concurrency-tool
special: JUC
original: true
show_title: juc-cyclicbarrier
date: 2019-09-18 13:33:42
---
CyclicBarrier顾名思义就是可循环使用的屏障。它主要实现的功能是让一组线程到达一个屏障(也可以叫同步点)时阻塞，直到最后一个线程到达屏障时，屏障才会放行，所有被屏障拦截的线程才可以继续运行。

### CyclicBarrier结构

CyclicBarrier结构如下：

![CyclicBarrier结构](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/CyclicBarrier结构.png)

通过上图我们可以看到，CyclicBarrier是通过ReentrantLock和Condition来实现的。它有两个构造方法，其源码如下：

```java
public CyclicBarrier(int parties) {
    this(parties, null);
}

public CyclicBarrier(int parties, Runnable barrierAction) {
    if (parties <= 0) throw new IllegalArgumentException();
    //拦截线程数量
    this.parties = parties;
    this.count = parties;
    //屏障放开前，执行的操作
    this.barrierCommand = barrierAction;
}
```

CyclicBarrier没有无参构造函数，它最少需要传递一个int变量来初始化拦截线程数量的个数。barrierAction它是一个实现了Runnable接口的参数，该参数不是必须的，它的作用是当屏障开发前，执行barrierAction参数中的run方法。

### await方法

await方法是CyclicBarrier中的关键方法，每个线程在调用await方法告诉CyclicBarrier该线程已经到达屏障了，然后线程被阻塞，直到最后一个线程到达屏障后，屏障才会放行，线程开始执行。await方法源码如下：

```java
public int await () throws InterruptedException, BrokenBarrierException {
    try {
        return dowait(false, 0 L);
    } catch (TimeoutException toe) {
        throw new Error(toe); // cannot happen
    }
}
```

await实际调用的是dowait方法，该方法的源码如下：

```java
private int dowait(boolean timed, long nanos) throws InterruptedException, BrokenBarrierException,
TimeoutException {
    //获取ReentrantLock锁对象
    final ReentrantLock lock = this.lock;
    //获取锁
    lock.lock();
    try {
        //分代
        final Generation g = generation;
	    //如果当前generation已经被损坏，则抛出BrokenBarrierException异常
        if (g.broken)
            throw new BrokenBarrierException();
		//当前线程被打断,抛出中断异常
        if (Thread.interrupted()) {
            //将损坏状态设置为true
            //并通知其他等待在此栅栏上的线程
            breakBarrier();
            throw new InterruptedException();
        }

        int index = --count;
        //如果当前是最后一个线程
        if (index == 0) { // tripped
            boolean ranAction = false;
            try {
                final Runnable command = barrierCommand;
                //执行栅栏任务
                if (command != null)
                    command.run();
                ranAction = true;
                //更新下一代，将count重置，generation重置
                //唤醒之前等待的线程
                nextGeneration();
                return 0;
            } finally {
                if (!ranAction)
                    breakBarrier();
            }
        }

        // loop until tripped, broken, interrupted, or timed out
        for (;;) {
            try {
                //如果没有时间限制，则直接进入等待状态，直到被唤醒
                if (!timed)
                    trip.await();
                //如果有时间限制，则等待指定时间
                else if (nanos > 0 L)
                    nanos = trip.awaitNanos(nanos);
            } catch (InterruptedException ie) {
                //当前代没有被损坏
                if (g == generation && !g.broken) {
                    //让栅栏失效
                    breakBarrier();
                    throw ie;
                } else {
                    // We're about to finish waiting even if we had not
                    // been interrupted, so this interrupt is deemed to
                    // "belong" to subsequent execution.
                    // 上面条件不满足，说明这个线程不是这代的
                    // 就不会影响当前这代栅栏的执行，所以，就打个中断标记
                    Thread.currentThread().interrupt();
                }
            }
		    // 当有任何一个线程中断了，就会调用breakBarrier方法
            // 就会唤醒其他的线程，其他线程醒来后，也要抛出异常
            if (g.broken)
                throw new BrokenBarrierException();
			// g != generation表示正常换代了，返回当前线程所在栅栏的下标
            // 如果 g == generation，说明还没有换代，那为什么会醒了？
            // 因为一个线程可以使用多个栅栏，当别的栅栏唤醒了这个线程，就会走到这里，所以需要判断是否是当前代。
            // 正是因为这个原因，才需要generation来保证正确。
            if (g != generation)
                return index;
			// 如果有时间限制，且时间小于等于0，销毁栅栏并抛出异常
            if (timed && nanos <= 0 L) {
                breakBarrier();
                throw new TimeoutException();
            }
        }
    } finally {
        lock.unlock();
    }
}
```

从上面的`dowait()`方法的源码中我们可以看出，`dowait()`方法的逻辑处理还是比较简单的，如果当前线程不是最后一个到达栅栏，则阻塞当前线程，除非遇到以下几种情况：

1. 最后一个线程到达，即index==0；
2. 当前线程被其它线程中断；
3. 当前线程超出指定等待时间；
4. 其它线程中断另一个等待的线程；
5. 其它的线程等待在栅栏处超时；
6. 其它线程调用了cyclicBarrier的reset()方法。reset()方法将cyclicBarrier重置为初始化状态。

###  Generation对象

在上面`dowait()`方法里面，我们可以看到其方法的实现是借助了Generation对象，那么Generation是什么呢？他究竟起到了什么作用了？下面我们就来看看Generation。

Generation在CyclicBarrier源码中给出的定义如下：

> barrier每使用一次就代表创建了一个generation的实例。当barrier被tripped或者reset时，对应的generation会发生改变。由于非确定性，锁可能会分配给等待的线程，因此可能会存在许多和使用barrier相关的generation，但是这些线程同一时间只能有一个处于活动状态，其余的要么broken，要么tripped。如果出现了中断，但是没有后续的reset，则不需要一个激活的generation。

上面Generation的定义可能不太好理解，简单的来说就是，同一批线程属于同一代，拥有相同的Generation对象；当有parties 个线程到达barrier后，Generation会被更新换代。Generation是线程是否属于同一代的标识。Generation定义如下：

```java
private static class Generation {
    //broken表示当前barrier是否处于中断状态，默认为false
    boolean broken = false;
}
```

当barrier被损坏或者有一个线程被中断时，则通过breakBarrier()方法来终止所有线程。

```java
private void breakBarrier() {
    generation.broken = true;
    count = parties;
    trip.signalAll();
}
```

在breakBarrier()中除了将broken设置为true，还会调用signalAll将在CyclicBarrier处于等待状态的线程全部唤醒。

当所有线程都已经到达barrier处（index == 0），则会通过nextGeneration()进行更新换的操作，在这个步骤中，做了三件事：唤醒所有线程、重置count和换代generation。

```java
private void nextGeneration() {
	trip.signalAll();
	count = parties;
	generation = new Generation();
}
```

### CyclicBarrier和CountDownLatch的区别

CountDownLatch的计数器只能使用一次，并且它是一个线程等待N个线程执行完后开始执行，而CyclicBarrier的计数器可以重复使用，且N个线程之间相互等待，任何一个线程完成之前，所有的线程都必须等待。

### 总结

* CyclicBarrier 的用途是让一组线程互相等待，直到全部到达某个公共屏障点才开始继续工作。
* CyclicBarrier 是可以重复利用的。
* 在等待的线程中只要有一个线程发生中断或者超时，则其它线程就会被唤醒继续并抛出BrokenBarrierException异常。
