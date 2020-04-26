---
title: AQS之独占式同步状态的获取和释放
tags:
  - Java
  - 线程
  - AQS
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: acquisition-and-release-of-exclusive-synchronization-state-of-aqs
show_title: acquisition-and-release-of-exclusive-synchronization-status-aqs
original: true
date: 2019-09-01 14:19:44
---
上一篇文章LZ分析了[AQS中的同步队列](https://www.zzwzdx.cn/JUC/aqs-chl-synchronization-queue-analysis/)，这一章LZ将分析AQS中独占式获取同步状态和释放。AQS提供提供的独占式获取同步状态和释放的模板方法有：

1. acquire(int arg);
2. acquireInterruptibly(int arg)
3. tryAcquireNanos(int arg, long nanosTimeout)
4. release(int arg)
5. tryRelease(int arg)

今天LZ将详细的介绍这几个模板方法的使用。


##### 1 acquire
acquire(int args) 方法的作用是独占式的获取同步状态，该方法对中断不敏感，也就是说当线程获取同步状态失败后进入到CHL中，后续对线程进行中断时，线程不会从CHL中移除。其源码如下：
```java
public final void acquire(int arg) {
     if (!tryAcquire(arg) && acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
         selfInterrupt();
 }

```
上述代码中主要完成了同步状态的获取、节点构建、加入到CHL和自旋等待的工作，源码分析如下：

* tryAcquire(arg)：尝试去获取同步状态，如果获取成功返回true,否则返回false。该方法是自定义同步器自己实现的方法，并且一定要保证线程安全。
* addWaiter(Node.EXCLUSIVE)：以独占的模式创建节点，并将节点添加到CHL的尾部。
* acquireQueued(addWaiter(Node.EXCLUSIVE), arg)：以死循环的方式获取同步状态。

因为tryAcquire(arg)方法需要自定义同步器自己实现，因此我们先来分享下addWaiter(Node.EXCLUSIVE)方法和acquireQueued(final Node node, int arg)方法，方法代码如下：
```java
private Node addWaiter(Node mode) {
    // 构建节点
    Node node = new Node(Thread.currentThread(), mode);
    // 尝试快速在尾部添加节点
    Node pred = tail;
    if (pred != null) {
        node.prev = pred;
        if (compareAndSetTail(pred, node)) {
            pred.next = node;
            return node;
        }
    }
    enq(node);
    return node;
}

private Node enq(final Node node) {
    for (;;) {
        Node t = tail;
        /**
        * 当CHL队列为空的时候，构建一个空节点作为头结点
        */
        if (t == null) {
            if (compareAndSetHead(new Node()))
                tail = head;
        } else {
            // 将node 节点添加到CHL尾部
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}
// 死循环获取同步状态
final boolean acquireQueued(final Node node, int arg) {
    boolean failed = true;
    try {
        boolean interrupted = false;
        for (;;) {
            final Node p = node.predecessor();
            // 只有当节点的前驱节点是同步器中个的head时,才有机会获取同步状态
            if (p == head && tryAcquire(arg)) {
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return interrupted;
            }
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())
                interrupted = true;
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}

```
上述的方法通过使用compareAndSetTail(pred, node)方法来确保节点能够被线程安全的添加到CHL尾部。在这里线程安全的添加到CHL是很重要的，如果不是线程安全的向CHL中添加节点，那么在一个线程获取到同步状态后，其它线程因为获取同步状态失败而并发的向CHL中添加节点时，CHL就不能保证数据的正确性了。
acquireQueued(final Node node, int arg) 方法可以看出当前线程是“死循环”的尝试获取同步状态，并且只有首节点才能获取同步状态。如果当前线程不是首节点则调用shouldParkAfterFailedAcquire(p, node)方法，若果该方法返回true,则线程进入阻塞状态，知道线程被唤醒才会继续运行。我们来看下shouldParkAfterFailedAcquire(p, node)的源码：

```java

private static boolean shouldParkAfterFailedAcquire(Node pred, Node node) {
    // 获取当前节点前驱节点的等待状态
    int ws = pred.waitStatus;
    /**
     * 如果前驱节点的状态值为-1，则返回true。标识当前node节点中的线程直接进入等待状态
     * 前面提到过 Node.SIGNAL的意思是当前驱节点释放同步状态后需要唤醒当前节点
     */
    if (ws ==  Node.SIGNAL)
        return true;
    /**
    * ws > 0 时，为Node.CANCLE，这个值标识当前节点因为中断或者取消，需要从CHL队列
    * 中移除，即将node的前面所有被标记为CANCLE状态的节点从CHL中移除
    */
    if (ws > 0) {
        do {
            node.prev = pred = pred.prev;
        } while (pred.waitStatus > 0);
        pred.next = node;
    } else {
        // CAS方式更新前驱节点的状态值为SIGNAL
        compareAndSetWaitStatus(pred, ws, Node.SIGNAL);
    }
    return false;
}

```
到此，acquire(arg)方法执行完毕，之后我们来看下acquire(arg)方法的流程：

![acquire方法的流程](http://cdn.zzwzdx.cn/blog/acquire方法的流程.png&blog)

##### 2 acquireInterruptibly
acquireInterruptibly(int arg)从命名是可以看出相比于acquire(ing arg)方法，该方法是响应中断的。也就是在说当线程在CHL中自旋的获取同步状态时，如果线程被中断了，会立刻响应中断并抛出InterruptedException异常。其源码如下：

```java
public final void acquireInterruptibly(int arg) throws InterruptedException {
    if (Thread.interrupted())
        throw new InterruptedException();
    if (!tryAcquire(arg))
        doAcquireInterruptibly(arg);
}
```
从上面的代码可以看出，当调用acquireInterruptibly(int arg) 方法时，会先判断线程是否被中断，如果中断了则抛出InterruptedException异常，否则调用tryAcquire(arg)方法来获取同步状态，如果获取同步状态失败，则调用doAcquireInterruptibly(arg)方法。我们来看下doAcquireInterruptibly(arg)方法的源码：
```java
private void doAcquireInterruptibly(int arg) throws InterruptedException {
    // 以独占模式构建节点并添加到CHL尾部
    final Node node = addWaiter(Node.EXCLUSIVE);
    boolean failed = true;
    try {
        for (;;) {
            // 获取当前节点的前驱节点
            final Node p = node.predecessor();
            // 判断前驱节点是否为头结点,如果是，则尝试获取同步状态
            if (p == head && tryAcquire(arg)) {
                //将node节点设置为head
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return;
            }
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
我们可以发现doAcquireInterruptibly(ing arg)方法和acquire(int arg)方法实现的功能完全一致，它们差别在于：

* doAcquireInterruptibly(ing arg)方法在声明时抛出了异常；
* 在是否需要中断是直接抛出中断异常，而不是返回中断标志。

##### 3 tryAcquireNanos

tryAcquireNanos超时的获取同步状态，其方法源码如下：
```java
public final boolean tryAcquireNanos(int arg, long nanosTimeout) throws InterruptedException {
    if (Thread.interrupted())
        throw new InterruptedException();
    return tryAcquire(arg) ||
        doAcquireNanos(arg, nanosTimeout);
}
```
从源码中可以看出，首先判断线程是否被中断，若果中断了就抛出InterruptedException异常，否则获取同步状态，如果获取同步状态失败在调用 doAcquireNanos(arg, nanosTimeout)方法。我们来看下 doAcquireNanos(arg, nanosTimeout)方法的定义：
```java
private boolean doAcquireNanos(int arg, long nanosTimeout) throws InterruptedException {
    if (nanosTimeout <= 0 L)
        return false;
    // 截止时间
    final long deadline = System.nanoTime() + nanosTimeout;
    // 独占式添加到CHL尾部
    final Node node = addWaiter(Node.EXCLUSIVE);
    boolean failed = true;
    try {
       // 自旋获取同步状态
        for (;;) {
            final Node p = node.predecessor();
            // 当前节点的前驱节点是头结点并且获取同步状态成功
            if (p == head && tryAcquire(arg)) {
                // 将当前节点设置为头节点
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return true;
            }
            // 计算需要睡眠的时间
            nanosTimeout = deadline - System.nanoTime();
            // 若果已经超时则返回false
            if (nanosTimeout <= 0 L)
                return false;
            // 若果没有超时，则等待nanosTimeout纳秒
            if (shouldParkAfterFailedAcquire(p, node) &&
                nanosTimeout > spinForTimeoutThreshold)
                LockSupport.parkNanos(this, nanosTimeout);
            // 判断线程是否被中断    
            if (Thread.interrupted())
                throw new InterruptedException();
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```
我们可以看到在doAcquireNanos(int arg, long nanosTimeout)方法中，首先判断超时时间是否小于等于0，如果小于等于0则返回false。若果超时时间大于0则计算出截止时间（final long deadline = System.nanoTime() + nanosTimeout;）若果当前节点不是头结点获取获取同步状态失败，则需要计算出睡眠时间（nanosTimeout = deadline - System.nanoTime();），如果睡眠时间小于等于0，则返回false，否则如果超时时间大于spinForTimeoutThreshold（1000L），则睡眠nanosTimeout纳秒，否则进入自旋。这里spinForTimeoutThreshold是AQS定义的一个常量，这里为什么要定义一个超时阈值呢？这是因为在线程从睡眠（TIME_WAITINT）状态切换到RUNNING状态会导致上下文的切换，如果超时时间太短，会导频繁的上下文切换而浪费资源。
整个超时控制的流程如下：
![超时控制的流程](http://cdn.zzwzdx.cn/blog/超时控制的流程.png&blog)

##### 4 release
当前线程在获取到同步状态并且执行完相关逻辑后，需要释放同步状态，并唤醒后继节点获取同步状态。release(int arg)方法定义如下：
```java
public final boolean release(int arg) {
    // 尝试释放同步状态
    if (tryRelease(arg)) {
        Node h = head;
        if (h != null && h.waitStatus != 0)
            // 唤醒后继节点
            unparkSuccessor(h);
        return true;
    }
    return false;
}
```
tryRelease(arg)方法是自定义同步器实现的方法，如果释放同步状态成功，则通过unparkSuccessor(h)方法来唤醒后续。具体unparkSuccessor方法的使用和定义LZ在后面再介绍。

最后总结下独占式获取同步状态和释放的流程：
>
>在多线程同时获取同步状态时，同步器会维护一个同步队列。线程在访问acquire(int arg)方法时会调用tryAcquire(int arg)方法，tryAcquire(int arg)方法是自定义同步器自己实现的一个**线程安全的方法** ，所有只能有一个线程能够获取到同步状态，其余获取同步状态失败的线程将被包装成节点加入到同步队列中。并且同步队列中的所有节点全部是自旋的方式判断当前节点的前驱节点是否是首节点，如果是首节点则不停的获取同步状态，若果获取同步状态成功，则退出同步队列，当线程执行完相应逻辑后，会释放同步状态，释放后会唤醒其后继节点。