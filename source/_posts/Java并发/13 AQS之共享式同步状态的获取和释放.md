---
title: AQS之共享式同步状态的获取和释放
tags:
  - Java
  - 线程
  - AQS
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: acquisition-and-release-of-shared-synchronization-state-of-aqs
show_title: acquisition-and-release-of-shared-synchronization-status-aqs
original: true
date: 2019-09-02 21:20:20
---

前面LZ介绍了[独占式获取同步状态和释放](https://www.zzwzdx.cn/JUC/acquisition-and-release-of-exclusive-synchronization-status-aqs/)，这一章LZ将介绍共享式同步状态的获取和释放。相比于独占式同一时刻只能有一个线程获取到同步状态，共享式在同一时刻可以有多个线程获取到同步状态。例如读写文件，读文件的时候可以多个线程同时访问，但是写文件的时候，同一时刻只能有一个线程进行写操作，其它线程将被阻塞。

#### 1 acquireShared
   AQS提供了acquireShared(int arg)模板方法来共享的获取同步状态，方法定义如下：
   ```java
public final void acquireShared(int arg) {
    if (tryAcquireShared(arg) < 0)
        // 获取同步状态失败，执行下面方法。
        doAcquireShared(arg);
}
   ```
从上面方法的定义中可以看出，方法首先调用了tryAcquireShared(arg) 方法尝试去获取同步状态，tryAcquireShared(arg) 方法的返回值是一个int值，当返回值大于等于0时，表示获取同步状态成功，否则获取同步状态失败。如果尝试获取同步状态失败，则调用 doAcquireShared(arg)自旋方法。自旋式获取同步状态方法的定义如下：
```java
private void doAcquireShared(int arg) {
    // 共享式节点,并添加到CHL尾部
    final Node node = addWaiter(Node.SHARED);
    boolean failed = true;
    try {
        boolean interrupted = false;
        for (;;) {
            // 获取当前节点的前驱节点
            final Node p = node.predecessor();
            // 判断前驱节点是否是头节点
            if (p == head) {
                // 尝试获取同步状态
                int r = tryAcquireShared(arg);
                // 获取同步状态成功
                if (r >= 0) {
                    setHeadAndPropagate(node, r);
                    p.next = null; // help GC
                    if (interrupted)
                        selfInterrupt();
                    failed = false;
                    return;
                }
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
从上面自旋式获取同步状态的定义中，可以看到只有是当前节点的前驱节点是头节点时，才尝试获取同步状态，当返回值大于等于0时，表示获取到了同步状态并从自旋的过程中退出。acquireShared(int arg)方法对中断不敏感，与独占式相似AQS也提供了响应中断的共享式获取同步状态方法acquireSharedInterruptibly(int arg)和超时等待共享获取同步状态方法 tryAcquireSharedNanos(int arg, long nanosTimeout)。这些方法的逻辑实现和独占式差不多，在这里就不在赘述了。

#### 2 releaseShared
与独占式一样，共享式也需要释放获取的同步状态。共享式释放同步状态的方法定义如下：
```java
public final boolean releaseShared(int arg) {
    if (tryReleaseShared(arg)) {
        doReleaseShared();
        return true;
    }
    return false;
}
```
该方法在释放同步状态后，将会唤醒后续处于等待状态的节点。因为存在多个线程同时释放同步状态，因此tryReleaseShared(arg)方法必须保证线程安全，一般是通过循环和CAS来完成的。