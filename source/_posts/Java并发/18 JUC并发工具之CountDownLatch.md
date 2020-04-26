---
title: JUC并发容器之CountDownLatch源码分析
tags:
  - Java
  - 线程
  - 锁
copyright: true
categories:
  - Java并发编程
translate_title: source-code-analysis-of-countdownlatch-of-juc-concurrent-container
special: JUC
original: true
show_title: juc-countdownlatch
date: 2019-09-16 12:57:32
---

CountDownLatch是一个同步辅助类，在完成一组正在其他线程中执行的操作之前，它允许一个或多个线程一直等待。它是通过一个计数器来实现的，当我们在new 一个CountDownLatch对象的时候需要带入该计数器值，该值就表示了线程的数量。每当一个线程完成自己的任务后，计数器的值就会减1。当计数器的值变为0时，就表示所有的线程均已经完成了任务，然后就可以恢复等待的线程继续执行了。

我们先用一个简单的实例来了解下CountDownLatch的使用，实例如下：

```java
public class CountDownLatchDemo {
	private static int LATCH_SIZE = 5;
	private static CountDownLatch doneSignal;
	public static void main(String[] args) {
		try {
			doneSignal = new CountDownLatch(LATCH_SIZE);
			// 新建5个任务
			for(int i=0; i<LATCH_SIZE; i++)
				new Task().start();
	 
			System.out.println("main await begin.");
			// "主线程"等待线程池中5个任务的完成
			doneSignal.await();
	 
			System.out.println("main await finished.");
		} catch (InterruptedException e) {
			e.printStackTrace();
		}
	}
	static class Task extends Thread{
		public void run() {
			try {
				Thread.sleep(1000);
				System.out.println(Thread.currentThread().getName() + " sleep 1000ms.");
				// 将CountDownLatch的数值减1
				doneSignal.countDown();
			} catch (InterruptedException e) {
				e.printStackTrace();
			}
		}
	}
}
```
说明：创建等待线程数为5，当主线程Main运行到doneSignal.wait()时会阻塞当前线程，直到另外5个线程执行完成之后主线程才会继续执行。
#### 构造函数

构造函数设置锁标识state的值，CountDownLatch countDownLatch = new  CountDownLatch(5) 实现的操作是设置锁标识state的值为5,其构建函数的源码如下：

```java
public CountDownLatch(int count) {
    if (count < 0) throw new IllegalArgumentException("count < 0");
    this.sync = new Sync(count);
}
```

sync为CountDownLatch的一个内部类，其定义如下：

```java
private static final class Sync extends AbstractQueuedSynchronizer {
    private static final long serialVersionUID = 4982264981922014374L;
    Sync(int count) {
        setState(count);
    }
    //获取同步状态
    int getCount() {
        return getState();
    }
    //获取同步状态
    protected int tryAcquireShared(int acquires) {
        return (getState() == 0) ? 1 : -1;
    }
    //释放同步状态
    protected boolean tryReleaseShared(int releases) {
        for (;;) {
            int c = getState();
            if (c == 0)
                return false;
            int nextc = c-1;
            if (compareAndSetState(c, nextc))
                return nextc == 0;
        }
    }
}
```

通过这个内部类Sync我们可以清楚地看到CountDownLatch是采用共享锁来实现的。

### await()

CountDownLatch中await的逻辑是如果state的值不等于0，表示还有其他线程没有执行完（其他线程执行完之后会将state减一操作），此时主线程处于阻塞状态,其定义如下：

```java
public void await() throws InterruptedException {
    sync.acquireSharedInterruptibly(1);
}
```

这里acquireSharedInterruptibly会进行state状态判断

```java
public final void acquireSharedInterruptibly(int arg)
    throws InterruptedException {
    if (Thread.interrupted())
        throw new InterruptedException();
    if (tryAcquireShared(arg) < 0) //tryAcquireShared函数用来判断state的值是否等于0
        doAcquireSharedInterruptibly(arg);
}
```

`tryAcquireShared`中的操作是判断锁标识位state是否等于0，如果不等于0，则调用doAcquireSharedInterruptibly函数，阻塞线程。内部类Sync重写了`tryAcquireShared(int args)`方法，其源码如下：

```java
protected int tryAcquireShared(int acquires) {
    return (getState() == 0) ? 1 : -1;  //判断锁标识位state是否等于0，在构造函数时会给state赋值
}
```

`doAcquireSharedInterruptibly(arg)`操作的判断是将当前线程放到FIFO队列中，并将线程阻塞。

```java
private void doAcquireSharedInterruptibly(int arg)
    throws InterruptedException {
    //将线程添加到FIFO队列中
    final Node node = addWaiter(Node.SHARED);
    boolean failed = true;
    try {
        for (;;) {
            final Node p = node.predecessor();
            if (p == head) {
                int r = tryAcquireShared(arg);
                if (r >= 0) {
                    setHeadAndPropagate(node, r);
                    p.next = null; // help GC
                    failed = false;
                    return;
                }
            }
            //parkAndCheckInterrupt完成线程的阻塞操作
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())
                throw new InterruptedException();
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```

### countDown()

 CountDownLatch中countDown()操作是将锁标识位state进行减一操作，如果state此时减一之后为0时则唤起被阻塞线程。

```java
public void countDown() {
    sync.releaseShared(1); //将state值进行减一操作
}
//releaseShared中完成的操作是将锁标识位state进行减一操作，如果state此时减一之后为0时则唤起被阻塞线程
public final boolean releaseShared(int arg) {
    if (tryReleaseShared(arg)) {//将锁标识位state进行减arg操作
        doReleaseShared();//唤起阻塞线程操作
        return true;
    }
    return false;
}
```

在tryReleaseShared中会完成state的减值操作。

```java
protected boolean tryReleaseShared(int releases) {
    // Decrement count; signal when transition to zero
    for (;;) {
        //获取state值
        int c = getState();
        if (c == 0)
            return false;
        //进行减一操作
        int nextc = c-1;
        //cas操作完成state值的修改
        if (compareAndSetState(c, nextc))
            //如果nextc等于0则返回
            return nextc == 0;
    }
}
```

doReleaseShared完成阻塞线程的唤起操作

```java
private void doReleaseShared() {
    for (;;) {
        Node h = head;
        if (h != null && h != tail) {
            int ws = h.waitStatus;
            if (ws == Node.SIGNAL) {
                if (!compareAndSetWaitStatus(h, Node.SIGNAL, 0))
                    continue;            // loop to recheck cases
                //完成阻塞线程的唤起操作
                unparkSuccessor(h);
            }
            else if (ws == 0 &&
                     !compareAndSetWaitStatus(h, 0, Node.PROPAGATE))
                continue;                // loop on failed CAS
        }
        if (h == head)                   // loop if head changed
            break;
    }
}
```


#### 总结

CountDownLatch内部通过共享锁实现。在创建CountDownLatch实例时，需要传递一个int型的参数：count，该参数为计数器的初始值，也可以理解为该共享锁可以获取的总次数。当某个线程调用await()方法，程序首先判断count的值是否为0，如果不会0的话则会一直等待直到为0为止。当其他线程调用countDown()方法时，则执行释放共享锁状态，使count值 – 1。当在创建CountDownLatch时初始化的count参数，必须要有count线程调用countDown方法才会使计数器count等于0，锁才会释放，前面等待的线程才会继续运行。注意CountDownLatch不能回滚重置。