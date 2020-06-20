---
title: AQS之阻塞和唤醒线程
tags:
  - Java
  - 线程
  - AQS
copyright: true
categories:
  - Java并发编程
translate_title: blocking-and-waking-threads-of-aqs
show_title: threadblocking-wakeup
special: JUC
original: true
date: 2019-09-04 10:07:35
---
在前面的文章中介绍了独占式同步状态的获取和释放以及共享式同步状态的获取和释放，在前面的文章中并没有介绍线程的阻塞和唤醒，在这篇文章中LZ将介绍在AQS中线程的阻塞和唤醒。
在线程获取同步状态失败后，会加入到CHL队列中去，并且该节点会自旋式的不断的获取同步状态，在获取同步状态的过程中，需要判断当前线程是否需要被阻塞。其主要方法在`acquireQueued(final Node node, int arg)`方法的定义里面：

```java
if (shouldParkAfterFailedAcquire(p, node) && parkAndCheckInterrupt())
    interrupted = true;
```
通过这段代码可以看出，线程在获取同步状态失败后，并不是立马进入等待状态，而是需要判断当前线程是否需要被阻塞。检查是否需要阻塞的方法`shouldParkAfterFailedAcquire(p, node)`，其定义如下：
```java
private static boolean shouldParkAfterFailedAcquire(Node pred, Node node) {
    // 获取前驱节点的等待状态
    int ws = pred.waitStatus;
    // 如果等待状态的值为SIGNAL,则返回true 表示当前线程需要等待
    if (ws == Node.SIGNAL)
        return true;
    if (ws > 0) {
        /*
         * 前驱节点的状态>0，为CANCLE状态，表示该节点被中断或者超时，需要
         * 从CHL中移除。
         */
        do {
            node.prev = pred = pred.prev;
        } while (pred.waitStatus > 0);
        pred.next = node;
    } else {
         /* 
         * 前驱节点为 PROPAGATE或者CONDITION 将前驱节点的等待状态以CAS的方式
         * 更新为SIGNAL
         */
        compareAndSetWaitStatus(pred, ws, Node.SIGNAL);
    }
    return false;
}
```
上面这段代码主要的功能就是判断当前线程是否需要阻塞，当该方法的返回值为true时，表示当前线程需要等待，反之返回false.其规则如下：

1. 如果当前节点的前驱节点的等待状态为SIGNAL，则返回true
2. 如果当前节点的前驱节点的等待状态为CALCLE，则表示该线程的前驱节点已经被中断或者超时，需要从CHL中删除，直到回溯到ws <= 0,返回false
3. 如果当前节点的前驱节点的等待状态为非SIGNAL,非CANCLE，则以CAS的方式设置其前驱节点为的状态为SIGNAL，返回false.

当 shouldParkAfterFailedAcquire(Node pred, Node node)方法返回true时，会执行 parkAndCheckInterrupt()方法。该方法定义如下：
```java
private final boolean parkAndCheckInterrupt() {
    LockSupport.park(this);
    return Thread.interrupted();
}
```
该方法就实现了将线程挂起，从而阻塞住线程的调用栈，已达到阻塞线程的目的。其内部则是调用了LockSupport工具类的park()方法来实现的。

当同步状态被释放后，需要唤醒后继节点：
```java
public final boolean release(int arg) {
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
unparkSuccessor()方法的定义如下：
```java
private void unparkSuccessor(Node node) {
    // 当前节点的等待状态
    int ws = node.waitStatus;
    // 当前节点状态 < 0，则CAS方法设置当前状态为0
    if (ws < 0)
        compareAndSetWaitStatus(node, ws, 0);

    // 当前节点的后继节点
    Node s = node.next;
    //  如果后继节点为空或者后继节点的等待状态为CANCLE
    if (s == null || s.waitStatus > 0) {
        s = null;
        for (Node t = tail; t != null && t != node; t = t.prev)
            if (t.waitStatus <= 0)
                s = t;
    }
    // 唤醒后继节点
    if (s != null)
        LockSupport.unpark(s.thread);
}
```
在这里很多人大概会有疑问为什么是从尾部回溯找到一个可用的节点，我们不妨先来回顾下添加节点的方法，
```java
private Node enq(final Node node) {
    for (;;) {
        Node t = tail;
        if (t == null) { // Must initialize
            if (compareAndSetHead(new Node()))
                tail = head;
        } else {
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}
```
在上面代码中我们可以看到，将节点添加到尾部是一个CAS操作，但是t.next = node 这个操作不是线程安全的，如果一个线程在执行CAS添加尾部之后正好有线程释放了同步状态，这个时候如果是从head到tail的遍历，则会出现中间断裂的情况，而从尾部回溯是一定可以遍历到所有节点的。
上面线程的唤醒和等待都是通过LockSupport工具类中的方法来实现的，我们来看看LockSupport这个工具类的。

### LockSupport

####  LockSupport介绍
LockSupport是用于创建锁和其他同步类的基本线程阻塞原语。
LockSupport定义了一组以park开头的方法用来阻塞线程，以及以unpark(Thread thread)方法来唤醒一个线程。park方法和unpark方法提供了阻止和解除阻塞线程的有效手段，该方法不会遇到Threaad.suspend和Thread.resum方法导致的死锁问题。

#### LockSupport方法列表

* getBlocker(Thread t) ：返回提供给最近调用尚未解除阻塞的park 方法调用的 blocker 对象，如果调用不阻止，则返回null
* park() : 禁止当前线程进行线程调度，除非许可证可用。
* park(Object blocker) ：禁止当前线程进行线程调度，除非许可证可用。
* parkNanos(long nanos) ：禁止当前线程进行线程调度，直到指定的等待时间，除非许可证可用。
* parkNanos(Object blocker, long nanos) ：禁止当前线程进行线程调度，直到指定的等待时间，除非许可证可用。
* parkUntil(long deadline) ：禁止当前线程进行线程调度，直到指定的截止时间，除非许可证可用。
* parkUntil(Object blocker, long deadline) ：禁止当前线程进行线程调度，直到指定的截止时间，除非许可证可用。
* unpark(Thread thread) ：为给定的线程提供许可证（如果尚未提供）。

上述方法中参数 blocker 是用来标识当前线程在等待的对象，该对象主要用于问题的排查和系统给的监控。

接下来我们在看看park和unpark方法的定义：

#### park：

```java
public static void park() {
    UNSAFE.park(false, 0 L);
}
```

#### unpark：

```java
public static void unpark(Thread thread) {
    if (thread != null)
        UNSAFE.unpark(thread);
}
```

从上面方法的定义中我们可以看出park和unpark方法都是通过UNSAFE类中的park和unpark方法来实现的。其UNSAFE中park和unpark的方法定义如下：
```java
public native void unpark(Object var1);

public native void park(boolean var1, long var2);
```
可以看出这2个方法都是本地方法。Unsafe是一个不安全的类，主要用于执行低级别、不安全的方法集合。尽管Unsafe类中的方法都是public的，但是我们还是不能在自己的java代码中调用这个类中的方法，因为只有授信的代码才能获取到该类的实例。
