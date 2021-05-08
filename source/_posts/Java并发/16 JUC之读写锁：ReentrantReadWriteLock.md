---
title: JUC之读写锁：ReentrantReadWriteLock源码解析
tags:
  - Java
  - 线程
  - 锁
copyright: true
categories:
  - Java并发编程
translate_title: 'read-write-lock-of-juc:-reentrantreadwritelock-source-code-analysis'
special: JUC
original: true
show_title: juc-write-lock
date: 2019-09-08 14:12:11
---

#### ReentrantReadWriteLock介绍

### ReentrantReadWriteLock介绍

读写锁的特性是在同一时刻，可以允许多个读线程访问，但是在写线程访问时，所有读线程和其它写线程都会被阻塞。读写锁内部维护了一对锁，它们分别是一个读锁和一个写锁。通过读锁和写锁的分离，使得并发性相比于一般的排他锁有了很大的提升。读写锁简化了读写交互场景的编程方式，在读写锁出现之前，如果要实现读写锁的功能，就要使用Java的等待通知机制，即当写操作时，所有晚于写操作的读操作均会进入等待状态，当写操作完成并通知之后，所有等待的读操作才能继续执行，这样做的目的是使得所有的读操作都能够获取正确的值，不会出现脏读。

一般情况下，读写锁的性能都会比排他锁好，因为在大多数场景中，读操作要多于写操作，在读操作多于写操作的情况下，读写锁能够提供比排它锁更好的并发和吞吐量。Java并发包提供的读写锁的实现是ReentrantReadWriteLock类，它的特性如下：

* 公平选择性：ReentrantReadWriteLock提供了公平锁和非公平锁的获取。默认是非公平锁。
* 重进入：ReentrantReadWriteLock支持重进入，读锁能够再次获取读锁，写锁也能够再次获取写锁。
* 锁降级：遵循获取写锁、获取读锁再释放写锁的顺序，写锁能够降级为读锁。

### ReentrantReadWriteLock结构

![ReentrantReadWriteLock结构](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/ReentrantReadWriteLock结构.png)

从上图我们可以大概了解ReentrantReadWriteLock类的内部构成。

* ReentrantReadWriteLock类实现了ReadWriteLock和Serializable接口。
* ReentrantReadWriteLock类中维护了ReadLock，WriteLock，Sync,NonfairSync和FairSync这个几个静态内部类。
* NonfairSync和FairSync又是继承Sync这个静态内部类。
* Sync这个类中又维护了HoldCounter和ThreadLocalHoldCounter这2个内部类，并且继承了AbstractQueuedSynchronizer

### 读写锁Sync对于AQS的使用

读写锁中`Sync`类是继承于`AQS`，并且主要使用上文介绍的数据结构中的`state`及`waitStatus`变量进行实现。 
实现读写锁与实现普通互斥锁的主要区别在于需要分别记录读锁状态及写锁状态，并且等待队列中需要区别处理两种加锁操作。 
`Sync`使用`state`变量同时记录读锁与写锁状态，将`int`类型的`state`变量分为高16位与低16位，高16位记录读锁状态，低16位记录写锁状态，如下图所示：![读写锁状态](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/读写锁状态.png)

###  ReentrantReadWriteLock源码分析

#### 写锁的获取与释放

写锁是一个支持重进入的排他锁，如果线程已经获取了写锁，则增加写状态。如果当前线程在获取写锁时，读锁已经被获取（读状态不为0）或者该线程不是已经获取到写锁的线程，则当前线程进入等待状态。获取写锁的代码如下：

```java
// 首先调用readLock的lock()方法
public void lock() {
	sync.acquire(1);
}
```

sync是继承了AbstractQueuedSynchronizer类的实例，因此调用acquire(1)方法实际是调用AbstractQueuedSynchronizer类中的acquire(int arg) 方法。其源码如下：

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```

在AQS系列文章中，分析了acquire(int arg)方法的实现，这里就不再赘述了。我们知道了tryAcquire(arg)方法是自定义同步器自己实现的方法。因此tryAcquire(arg) 方法的源码如下：

```java
protected final boolean tryAcquire(int acquires) {
	// 获取当前线程
    Thread current = Thread.currentThread();
    // 获取同步状态
    int c = getState();
    // 获取写状态值
    int w = exclusiveCount(c);
    // 判是否有线程持有同步状态，即线程获取了读锁或者写锁
    if (c != 0) {
        /* 
        * 如果写状态为0，则表示写锁未被持有,但是c!=0,表示读锁已经被持有  
        * 或者 当前线程不是持有锁的线程，则返回获取锁失败
        */
        if (w == 0 || current != getExclusiveOwnerThread())
            return false;
        // 当w != 0 或者 当前线程是持有锁的线程，进行下面操作
        // 如果重入读锁的次数超过限制，抛出异常
        if (w + exclusiveCount(acquires) > MAX_COUNT)
            throw new Error("Maximum lock count exceeded");
        // 设置同步状态为写锁的重入次数
        setState(c + acquires);
        // 获取写锁成功
        return true;
    }
    // 当同步状态为0时，表示读锁或者写锁都未被持有
   	// 如果写线程应该被阻塞 或者 CAS设置同步状态失败，则返回false
    if (writerShouldBlock() ||
        !compareAndSetState(c, c + acquires))
        return false;
    // 获取写锁成功，设置当前线程未独占线程
    setExclusiveOwnerThread(current);
    return true;
}
```

上述方法中，我们看到写锁的同状态是通过exclusiveCount(c)方法来获取的，我们来看看exclusiveCount(c)的定义，其源码如下：

```java
static final int SHARED_SHIFT   = 16;
static final int EXCLUSIVE_MASK = (1 << SHARED_SHIFT) - 1;
// 获取独占锁状态
static int exclusiveCount(int c) { 
    // 相当于 c & 0XFFFF
    return c & EXCLUSIVE_MASK; 
}
```

从上面源码我们可以看到，读写锁中写状态就是同步状态state的低16位。这也可以解释为什么`w + exclusiveCount(acquires) > MAX_COUNT`条件会抛出异常的原因。

写锁的释放与ReentrantLock的释放过程基本类似，每次释放均减少写状态，当写状态为0时，表示写锁已经被释放，从而等待的读写线程能够继续访问读写锁。同步前一次写线程的修改的值对后续的读写线程可见。

#### 读锁的获取与释放

读锁是一个支持重进入的共享锁，同一时刻它能被多个线程同时获取，在没有其它写线程访问时，读锁总会被获取成功。如果当前线程已经获取了读锁，则增加读状态。如果当前线程在获取读锁时，写锁已经被其它线程获取，则进入等待状态。读锁获取源码如下：

```java
protected final int tryAcquireShared(int unused) {
    // 获取当前线程
    Thread current = Thread.currentThread();
    // 获取同步状态
    int c = getState();
    // 如果写状态不为0，则表示存在写锁。且当前线程不是持有写锁的线程，则获取读锁失败
    if (exclusiveCount(c) != 0 &&
        getExclusiveOwnerThread() != current)
        return -1;
    // 获取读状态
    int r = sharedCount(c);
    
    /**
    * 1. 判断读线程是否应该被阻塞
    * 2. 判断读状态释放超过最大值
    * 3. CAS设置同步状态释放成功
    */
    if (!readerShouldBlock() &&
        r < MAX_COUNT &&
        compareAndSetState(c, c + SHARED_UNIT)) {
        // 上面已经判断过写状态为0，此时如果读状态为0，表示可以直接获取读锁
        if (r == 0) {
            // firstReader：获取读锁的第一个线程
            firstReader = current;
            // firstReaderHoldCount：第一个读线程持有读锁的重入次数
            firstReaderHoldCount = 1;
        } else if (firstReader == current) {
            firstReaderHoldCount++;
        } else {
            //下面一段代码的作用是 记录每一个读线程获取读锁的重入次数
            HoldCounter rh = cachedHoldCounter;
            if (rh == null || rh.tid != getThreadId(current))
                cachedHoldCounter = rh = readHolds.get();
            else if (rh.count == 0)
                readHolds.set(rh);
            rh.count++;
        }
        return 1;
    }
    // 获取读锁失败，放到循环里重试。即在并发获取读锁的情况下，CAS失败的线程进入这里
    return fullTryAcquireShared(current);
}

final int fullTryAcquireShared(Thread current) {
    // rh:当前线程持有锁计数的变量
    HoldCounter rh = null;
    for (;;) {
        // 获取同步状态
        int c = getState();
        // 判断写状态是否为0
        if (exclusiveCount(c) != 0) {
            //如果写状态不为0，且当前线程不是持有写锁的线程，则获取读锁失败
            if (getExclusiveOwnerThread() != current)
                return -1;
            // 否则，当前线程持有写锁，在这里阻塞将会导致死锁
        /**
        * 判断读线程是否被阻塞 
        * 这里readerShouldBlock()返回true的条件分为2种：
        * 1.当是公平锁时，readerShouldBlock()返回true的条件是当前线程所在的节点有前驱节点
        * 2.当是非公平锁时，readerShouldBlock()返回true的条件是等待队列中，头结点的下一个节点是独占节点，即为写锁等待。
        * 下面的一段代码，在读线程需要被阻塞的情况下，需要考虑读写锁的重入性
        */
        } else if (readerShouldBlock()) {
           // 当前显示是第一个获取读锁的线程时，锁重入不需要等待
            if (firstReader == current) {
                // assert firstReaderHoldCount > 0;
            } else {
                if (rh == null) {
                    rh = cachedHoldCounter;
                    if (rh == null || rh.tid != getThreadId(current)) {
                        // 获取当前线程持有读锁情况
                        rh = readHolds.get();
                        // 如果当前线程持有读锁的重入数量为0，即当前线程没有获取过读锁，也就是当前线程没有锁重进入特性
                        if (rh.count == 0)
                            readHolds.remove();
                    }
                }
                // 当前读线程没有读锁的重进入，则获取读锁失败，需要进入等待队列
                if (rh.count == 0)
                    return -1;
            }
        }
        // 这里，写锁状态为0，或者当前线程还有写锁，且线程也不需要被阻塞，说明可以获取读锁
        // 如果当前读锁状态值已经改为最大值，则抛出异常
        if (sharedCount(c) == MAX_COUNT)
            throw new Error("Maximum lock count exceeded");
        // CAS方式设置读锁状态值，设置成功，读锁获取成功，设置失败自旋，重新从方法头开始
        if (compareAndSetState(c, c + SHARED_UNIT)) {
            // 下面一段代码的主要作用就是 设置 线程获取读锁的重入次数
            if (sharedCount(c) == 0) {
                firstReader = current;
                firstReaderHoldCount = 1;
            } else if (firstReader == current) {
                firstReaderHoldCount++;
            } else {
                if (rh == null)
                    rh = cachedHoldCounter;
                if (rh == null || rh.tid != getThreadId(current))
                    rh = readHolds.get();
                else if (rh.count == 0)
                    readHolds.set(rh);
                rh.count++;
                cachedHoldCounter = rh; // cache for release
            }
            return 1;
        }
    }
}
```

这里我们看到读锁的获取是比较复杂的，这里LZ再用一张图来表明读锁获取的整个流程。

![读锁获取流程](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/读锁获取流程.png)



#### 读锁的释放

在ReadLock中调用unlock()方法即释放读锁，unlock()方法定义如下：

```java
public void unlock() {
    sync.releaseShared(1);
}
```

可以看到，unlock()方法中调用的是`Sync`中的`releaseShared(int arg)`方法，这个方法在AQS类中，实际上真正调用的是`Sync`中的`tryReleaseShared(arg)`方法，该方法定义如下：

```java
protected final boolean tryReleaseShared(int unused) {
    // 获取当前线程
    Thread current = Thread.currentThread();
    // 判断当前线程是否是一个获取读锁的线程
    if (firstReader == current) {
        // 如果当前线程是第一个获取读锁的线程
        // 如果第一个获取读锁线程的获取读锁的计数为1，则设置第一个获取读锁的线程为null
        if (firstReaderHoldCount == 1)
            firstReader = null;
        else
            // 否则 第一个获取读锁的线程的获取读锁的次数减一
            firstReaderHoldCount--;
    } else {
        // 如果当前线程不是第一个获取读锁的线程
        // 获取线程计数的缓存
        HoldCounter rh = cachedHoldCounter;
        // 如果rh == null 获取 rh 不是当前线程的HoldCounter，则获取当前线程的HoldCounter
        if (rh == null || rh.tid != getThreadId(current))
            rh = readHolds.get();
        // 获取当前线程获取读锁的次数
        int count = rh.count;
        if (count <= 1) {
            // 如果当前线程获取读锁的重入次数 <= 1，则将当前线程的HoldCounter从readHolds中移除
            // readHolds是ThreadLocalHoldCounter的实例，它继承ThreadLocal
            readHolds.remove();
            if (count <= 0)
                throw unmatchedUnlockException();
        }
        // 当前线程读锁的重入次数减一
        --rh.count;
    }
    // 这里使用死循环的方式，确保当前线程的读锁能够释放
    for (;;) {
        int c = getState();
        // 读状态每次减一，相当于AQS中state的值每次减少的值是 1<< 16 
        int nextc = c - SHARED_UNIT;
        // CAS方式更新state的值
        if (compareAndSetState(c, nextc))
            // 这里讲state == 0 作为释放成功的条件
            // 这里大家可能会有疑问，如果读锁是否完成，但是state 不为0呢，
            // 这很好理解，当读锁释放完毕但是state不为0时，表示写锁还未被释放
            // 既然写锁还存在，那么读锁释放完了，也不应该通知阻塞在CHL队列中的读线程来竞争锁
            // 因为读锁时排它锁，通知了读线程也会继续阻塞
            return nextc == 0;
    }
}
```

### 锁降级

锁降级指的是写锁降级为读锁。锁降级需要遵循先获取写锁，然后获取读锁，在释放写锁的次序。需要注意的是，如果线程先获取写锁，然后释放写锁，再获取读锁，这种分段完成的过程不能称为锁降级。

锁降级在 tryAcquireShared 方法和 fullTryAcquireShared 中都有体现，例如下面的判断：

```java
if (exclusiveCount(c) != 0) {
    if (getExclusiveOwnerThread() != current)
        return -1;
```

上面的代码的意思是：当写锁被持有时，如果持有该锁的线程不是当前线程，就返回 “获取锁失败”，反之就会继续获取读锁。称之为锁降级。

锁降级中读锁的获取是否是必须要的呢？答案是**必要的**。主要是为了保证数据的可见性，试想一下，假如当前线程（A）直接释放写锁而不获取读锁，此时另一个线程（B）获取了写锁并且修改了数据，那么线程B修改后的数据是不会对线程A可见的。如果获取了读锁，那么线程B将会因为写锁的存在而被阻塞，直到当前线程A使用数据并释放读锁之后，线程B才能够获取写锁对数据进行修改。
