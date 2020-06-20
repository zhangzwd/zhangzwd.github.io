---
title: JUC之重入锁：ReentrantLock源码解析
tags:
  - Java
  - 线程
  - 锁
copyright: true
categories:
  - Java并发编程
translate_title: 'reentrantlock-of-juc:-source-code-analysis-of-reentrantlock'
special: JUC
original: true
show_title: reentrantlock-parsing
date: 2019-09-05 13:18:42
---
### ReentrantLock简介
ReentrantLock可重入锁，它表示该锁能够支持一个线程对资源的重复加锁。除此之外还支持获取锁时的公平和非公平性的选择，也就是说ReentrantLock可以构建成一个公平锁，也可以构建成一个非公平锁。在java中与ReentrantLock一样可重入的锁就是synchronized关键字，synchronized关键字的隐式支持重进入，比如在一个递归的方法前面使用synchronized修饰，在方法执行时，线程在获取到了锁后然后可以继续获取锁执行代码。ReentrantLock虽然不像synchronized关键字一样支持隐式的重进入，但是ReentrantLokc在调用lock()方法时，已经获取到锁的线程能够再次调用lock()方法获取锁而不被阻塞。

这里提到了一个获取锁的公平性问题，如果在绝对的时间上，先等待的线程一定会优先获取到锁，那么这锁就是公平的，反之就是非公平的。从这里我们可以看出，公平性的锁效率是没有非公平性锁高的，但是为什么会有公平性的锁呢？那是因为公平性的锁能够减少"饥饿"发生的概率，等待越久的请求越是能够得到优先的满足。

### 2ReentrantLock 结构
![ReentrantLock结构](http://cdn.zzwzdx.cn/blog/ReentrantLock结构.png&blog)

从上面的UML图中，我们可以看到ReentrantLock实现了Lock和Serializable接口，含有3个静态内部类，Sync、NonfairSync和FairSync。其中Sync是一个抽象内部类且继承了AbstractQueuedSynchronizer，NonfairSync（非公平锁）和FairSync（公平锁）都继承了Sync这个抽象类。

### ReentrantLock方法列表

* `public ReentrantLock()`：无参构造函数，创建一个非公平性的ReentrantLock实例 
* `public ReentrantLock(boolean fair)`：创建一个ReentrantLock实例 fair参数如果为true,则ReentrantLock实例为公平锁，否则为非公平锁
* `public void lock()`：获取锁
* `public void lockInterruptibly() throws InterruptedException`：获取锁，对中断敏感
* `public boolean tryLock()`：尝试获取锁，获取成功返回true,反正返回false.
* `public void unlock()`：释放锁
* `public Condition newCondition()`：创建一个Condition实例。
* `public int getHoldCount()`：查询当前线程对该锁的持有数量。
* `public boolean isHeldByCurrentThread()`：查询此锁是否被当前线程持有
* `public boolean isLocked()`：查询此锁是否有线程持有
* `public final boolean isFair()`：查询此锁是否是公平锁，如果是公平锁则返回true,反之返回false.
* `protected Thread getOwner()`：获取当前持有该锁的线程，如果返回null,则表示该锁没有被任何线程持有
* `public final boolean hasQueuedThreads()`：查询是否有线程在等待获取该锁
* `public final boolean hasQueuedThread(Thread thread)`：查询给定的线程是否在等待获取该锁
* `public final int getQueueLength()`：获取等待获取该锁的线程个数的预估值，该值是一个预估值，因为在遍历内部数据结构时，线程的数量可能动态的改变
* `protected Collection<Thread> getQueuedThreads()`：获取等待获取该锁的线程集合
* `public boolean hasWaiters(Condition condition) `：查询是否有线程正在等待在该锁给定的等待条件下
* `public int getWaitQueueLength(Condition condition)`：获取等待在该线程给定的等待条件下的线程预估量
* `protected Collection<Thread> getWaitingThreads(Condition condition)`：获取等待在该锁给定的等待条件下的线程集合

### ReentrantLock 锁的获取

一般我们在使用ReentrantLock获取锁的时候是这样实现的：
```java
// 非公平锁
ReentrantLock lock = new ReentrantLock();
lock.lock();
```
lock方法的定义：
```java
public void lock() {
    sync.lock();
}
```
上面lock方法的实现非常的简单，就是调用了sync的lock方法，而sync是ReentrantLock类中的一个属性，该属性的类型是Sync类，Sync类是ReentrantLock类的一个抽象内部类，它继承了AbstractQueuedSynchronizer（AQS）同步器从而获取了锁。我们再来看看sync这个属性是在什么时候赋值的。
```java
public ReentrantLock() {
    sync = new NonfairSync();
}
public ReentrantLock(boolean fair) {
    sync = fair ? new FairSync() : new NonfairSync();
}
```
从上面代码中我们可以看到，sync 属性是在ReentrantLock的构造方法中赋值的，并且赋值的类型是NonfairSync或者FairSync。我们在ReentrantLock的UML图中已经知道了NonfairSync和FairSync类都是Sync的子类，这里又应用了Java的多态技术，即父类的引用指向子类对象。既然利用的是多态，那么就知道sync.lock()实际调用到的是NonfairSync类中的lock()方法或者FairSync类中的lock()方法。

#### 非公平锁的获取
非公平锁lock方法的定义：
```java
 final void lock() {
    // 尝试获取锁
     if (compareAndSetState(0, 1))
         setExclusiveOwnerThread(Thread.currentThread());
     else
        // 获取锁失败，调用AQS中的acquire(int arg)方法
         acquire(1);
 }
```
首先或尝试获取锁，如果获取锁失败，则调用AQS中的acquire(int arg)方法，该方法定义如下：
```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```
这个方法首先调用tryAcquire(arg) 方法，而在前面的文章中LZ提到过tryAcquire(arg) 方法是需要同步器组件自己实现的方法，我们来看看这个方法在非公平锁中的定义：
```java
protected final boolean tryAcquire(int acquires) {
    return nonfairTryAcquire(acquires);
}

// Sync中默认实现非公平尝试获取锁的方法
final boolean nonfairTryAcquire(int acquires) {
    // 获取当前线程、
    final Thread current = Thread.currentThread();
    // 获取同步状态
    int c = getState();
    // 如果同步状态等于0 表示锁处于空闲状态 
    if (c == 0) {
        // 获取锁成功，设置为当前线程所有
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } 
    // 锁重入
    // 判断持有锁的线程是否是当前线程
    else if (current == getExclusiveOwnerThread()) {
        // 计算获取锁的次数
        int nextc = c + acquires;
        if (nextc < 0) // overflow
            throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}
```
这段代码主要实现的逻辑：首先判断同步状态state是否等于0，如果等于0表示该锁还未被任何线程锁持有，直接利用CAS获取同步状态，如果获取同步状态成功，则设置该锁为当前线程拥有并返回true。如果同步状态state不等于0，则判断持有该锁的线程是否为当前线程，如果是则获取锁，并计算该线程获取锁的次数，然后赋值给state。

#### 公平锁的获取
公平锁lock方法的定义：
```java
final void lock() {
    // 调用AQS中的acquire(int arg)方法
    acquire(1);
}
```
我们可以看到公平锁做lock方法的实现是直接调用AQS中的acquire(int arg)方法。上面我们已经分析过acquire(int arg)方法中会调用tryAcquire(int arg)方法，而这个方法需要同步器自己实现，我们来看看公平锁中tryAcquire(int arg)方法的定义：
```java
protected final boolean tryAcquire(int acquires) {
    // 获取当前线程
    final Thread current = Thread.currentThread();
    // 获取同步状态
    int c = getState();
    // 如果同步状态等于0，表示该锁空闲
    if (c == 0) {
        // hasQueuedPredecessors() 查询是否有线程等待的时间比当前线程更长，如果有true,没有返回false
        if (!hasQueuedPredecessors() &&
            compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } 
    // 重入 和非公平锁一样
    else if (current == getExclusiveOwnerThread()) {
        int nextc = c + acquires;
        if (nextc < 0)
            throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}
```
上述方法中，唯一和非公平锁不一样的地方在于，当state == 0时，不是用CAS获取同步状态，而是先判断是否有比当前线程等待更长时间的线程，如果存在，则当前线程不获取锁。

### 锁的释放
锁的释放不存在公性和非公平性的问题，因此锁释放的定义如下：
```java
public void unlock() {
    sync.release(1);
}
// 同步器Sync实现的tryRelease(int arg)方法
protected final boolean tryRelease(int releases) {
    // 当前同步状态减去releases
    int c = getState() - releases;
    // 释放的锁是否是当前持有锁的线程，不是抛出异常
    if (Thread.currentThread() != getExclusiveOwnerThread())
        throw new IllegalMonitorStateException();
    boolean free = false;
    // 如果state == 0,表示已经释放完全，其它线程可以获取锁了
    if (c == 0) {
        free = true;
        setExclusiveOwnerThread(null);
    }
    setState(c);
    return free;
}
```
从上面的代码中我们可以看出，如果一个锁被释放了n次，那么前（n-1）次tryRelease(int releases) 方法必须返回false，而只有同步状态完全释放了，才返回true。可以看到，该方法将同步状态是否为0作为最终是否释放锁的条件，当同步状态为0时，锁释放成功，设置锁占有的线程为null。

