---
title: JUC阻塞队列之ArrayBlockingQueue源码分析
tags:
  - Java
  - 线程
  - ArrayBlockingQueue
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: source-code-analysis-of-arrayblockingqueue-of-juc-blocking-queue
original: true
show_title: juc-array-blocking-queue
date: 2019-09-30 20:00:28
---
ArrayBlockingQueue是一个由数组实现的有界阻塞队列。这个队列会按照先进先出（FIFO）的原则对元素进行排序。

ArrayBlockingQueue提供了公平性和非公平性的选择，默认情况下ArrayBlockingQueue不保证先出公平的访问队列，这里公平性的访问队列是指阻塞的线程可以按照阻塞的先后顺序访问队列，即先阻塞的线程先访问队列。反之先阻塞的线程不一定能够先访问队列即为非公平性。为了保证公平性，通常会降低吞吐量。

#### ArrayBlockingQueue构造函数

ArrayBlockingQueue提供了3种构建队列的方式，他们分别如下：

* 方式一：

```java
// 使用给定的容量来创建一个非公平性的ArrayBlockingQueue
public ArrayBlockingQueue(int capacity) {
    this(capacity, false);
}
```

这种方式默认构建的是一个非公平性的有界阻塞队列。

* 方式二：

```java
// 使用给定的容量大小和指定的访问策略来构建一个ArrayBlockingQueeu
// 当fair为false时，ArrayBlockingQueeu是非公平性的，反之，则为公平性的
public ArrayBlockingQueue(int capacity, boolean fair) {
    //参数检测
    if (capacity <= 0)
        throw new IllegalArgumentException();
    //初始化数组大小
    this.items = new Object[capacity];
    //创建公平/非公平的重入锁
    lock = new ReentrantLock(fair);
    //队列不空的条件
    notEmpty = lock.newCondition();
    //队列不满的条件
    notFull =  lock.newCondition();
}
```

* 方式三：

```java
// 使用给定的容量大小和指定的访问策略来构建一个ArrayBlockingQueeu并将传入的集合放到队列中
public ArrayBlockingQueue(int capacity, boolean fair, Collection<? extends E> c) {
    //方式二的构建
    this(capacity, fair);
	//获取构建时得到的重入锁	
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lock(); // Lock only for visibility, not mutual exclusion
    try {
        int i = 0;
        try {
            for (E e : c) {
                //元素不能为null
                checkNotNull(e);
                //将集合中的元素放入到队列中
                items[i++] = e;
            }
        } catch (ArrayIndexOutOfBoundsException ex) {
            throw new IllegalArgumentException();
        }
        count = i;
        //put下一个元素的下标
        putIndex = (i == capacity) ? 0 : i;
    } finally {
        //解锁
        lock.unlock();
    }
}
```

构造函数主要的逻辑就是初始化数组大小，并初始化公平/非公平的重入锁，并初始化队列满和空的条件。看完了构造函数，下面我们来看看ArrayBlokcingQueue的入列和出列操作。

#### 入列

ArrayBlockingQueue提供了4中入列操作，分别如下：

* `add(E e):`当队列满时，调用次方法向队列中插入元素为抛出*IllegalStateException("Queue full")*异常，添加元素成功返回true。
* `offer(E e):`当队列满时，调用次方法向队列中添加元素会返回false，添加元素成功则返回true。
* `put(E e) throws InterruptedException:`当队列满时，调用次方法向队列中添加元素，线程会被阻塞。直到队列不满或者线程被打断则从方法退出。
* `offer(E e, long timeout, TimeUnit unit) throws InterruptedException:` 当队列满时，调用次方法向队列中添加元素，会等待timout时间，当时间超过timeout时返回false。

分析了这4中入列操作的不同，我们接下来看看在ArrayBlockingQueue中它们是如何实现的。

**add(E e)方法：**

```java
public boolean add(E e) {
    //调用父类的add方法
    return super.add(e);
}
```

我们继续看父类的`add`方法做了什么操作，ArrayBlockingQueue基础了`AbstractQueue`这个了抽象类，那么调用父类的add方法就是调用`AbstractQueue`抽象类中的add方法，其方法定义如下：

```java
public boolean add(E e) {
    //调用offer方法，如果成功则返回true，失败则抛出IllegalStateException异常
    if (offer(e))
        return true;
    else
        throw new IllegalStateException("Queue full");
}
```

我们看到父类的`add`方法实际是调用了子类的offer方法，前面我们说的offer方法在队列满时返回false，则队列还未满时，将元素添加到队列中并返回true。所以`add`方法是借助于`offer`方法来实现的。

**offer(E e)方法：**

offer(E e)方法的源码如下：

```java
public boolean offer(E e) {
    //检查元素是否为null，为null则抛出NullPointerException异常
    checkNotNull(e);
    //获取可重入锁
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lock();
    try {
        //判断对了中的元素个数和队列的长度是否相等，相等标识队列已经满了，返回false
        if (count == items.length)
            return false;
        else {
            //添加元素到队列并返回true
            enqueue(e);
            return true;
        }
    } finally {
        //解锁
        lock.unlock();
    }
}
```

`offer`方法利用ReentrantLock实现线程安全，offer方法逻辑比较简单，其主要添加的元素的逻辑在`enqueue`方法中，我们来看看`enqueue`方法的源码：

```java
private void enqueue(E x) {
    final Object[] items = this.items;
    // 将元素添加到putIndex的位置
    items[putIndex] = x;
    // 如果队列满了，则将putIndex重置为0
    if (++putIndex == items.length)
        putIndex = 0;
    //队列中的元素个数自增
    count++;
    //唤醒阻塞在notEmpty条件上的线程
    notEmpty.signal();
}
```

从上面源码中我们可以看出，`add`和`offer`方法在添加元素的时候并不会阻塞线程，`add`方法在队列满时抛出异常，`offer`方法在队列满时直接返回false。

**put(E e)方法：**

在前面我们说过`put`方法在向队列中添加元素时，如果队列满则会阻塞线程，直到线程被打断或者被其它线程通知，下面我们看看`put`方法的源码。

```java
public void put(E e) throws InterruptedException {
    //检查元素是否为null,如果为Null，则抛出NullPointerException异常
    checkNotNull(e);
    //获取可重入锁
    final ReentrantLock lock = this.lock;
    //可中断的获取锁
    lock.lockInterruptibly();
    try {
        //如果队列满，则阻塞在notFull条件队列上
        while (count == items.length)
            notFull.await();
        //如果队列没有满，则将元素添加到队列上
        enqueue(e);
    } finally {
        lock.unlock();
    }
}
```

`put`方法的逻辑也比较简单，这里若果看了LZ前面关于[AQS之独占式同步状态的获取和释放]()的这篇文章，则很好理解`lock.lockInterruptibly();`的作用，它的目的就是响应中断的获取锁，若果获取锁成功，则执行下面的代码，如果获取锁失败，则获取进入的同步队列中以自旋式的获取锁，直到线程被中断或者获取锁成功才会退出同步队列。

**offer(E e, long timeout, TimeUnit unit)方法：**

超时等待的向队列中添加元素，如果队列满时，调用该方法则会阻塞timeout时间，如果在此期间有线程取走了元素并且当前线程被唤醒则会将元素添加到队列中去，若果timeout时间后队列任然是满的，则返回false，其源码如下：

```java
public boolean offer(E e, long timeout, TimeUnit unit) throws InterruptedException {
	//检查元素是否为null
    checkNotNull(e);
    //将timeout转化为纳秒
    long nanos = unit.toNanos(timeout);
    final ReentrantLock lock = this.lock;
    //可中断的获取锁
    lock.lockInterruptibly();
    try {
        //如果队列满并且已经超时，则返回false
        while (count == items.length) {
            if (nanos <= 0)
                return false;
            //阻塞
            nanos = notFull.awaitNanos(nanos);
        }
        //添加元素
        enqueue(e);
        return true;
    } finally {
        lock.unlock();
    }
}
```

#### 出列

上面分析了ArrayBlockingQueue入列的情况，下面我们来分析ArrayBlockingQueue出列的情况。ArrayBlockingQueue同样提供了4中出列操作，它们分别是：

* `E poll():`从队列的头部取出一个元素，若果队列为空，则返回null。
* `E take():`从队列的头部取出一个元素，如果队列为空，则阻塞。
* `E poll(long timeout, TimeUnit unit):`从队列头部取出一个元素，如果队列为空，则等待timeou时间。
* `E peek():`查看队列第一个非空的元素，并不会将次元素从队列中移除。

对这些处理操作有了一个了解后我们来看看它们是如何实现的。

**poll()方法：**

`poll`方法源码如下：

```java
public E poll() {
    // 获取可重入锁
    final ReentrantLock lock = this.lock;
    // 加锁
    lock.lock();
    try {
        // 若果队列为空，则返回null,否则调用dequeue()方法
        return (count == 0) ? null : dequeue();
    } finally {
        // 解锁
        lock.unlock();
    }
}
```

`poll`方法逻辑很简单，其重点是`dequeue`方法，这里我们先不看`dequeue`方法我们接着看其它的出队操作。

**take()方法：**

`take`方法是阻塞的从队列中获取元素，其源码如下：

```java
public E take() throws InterruptedException {
    //获取锁
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lockInterruptibly();
    try {
        //如果队列中没有元素，则等待
        while (count == 0)
            notEmpty.await();
        // 获取元素
        return dequeue();
    } finally {
        // 释放锁
        lock.unlock();
    }
}
```

`take`方法与前面介绍的`put`方法逻辑非常相似，只不过一个是添加元素一个是获取元素而已。这里我们看到`take`方法的核心任然是`dequeue`方法。

**poll(long timeout, TimeUnit unit)方法：**

从方法参数中我们就可以判断出，该方法是等待超时的方法，其源码如下：

```java
public E poll(long timeout, TimeUnit unit) throws InterruptedException {
    long nanos = unit.toNanos(timeout);
    //获取可重入锁
    final ReentrantLock lock = this.lock;
    //尝试获取锁
    lock.lockInterruptibly();
    try {
        //如果队列为空，则阻塞nanos纳秒
        while (count == 0) {
            if (nanos <= 0)
                return null;
            nanos = notEmpty.awaitNanos(nanos);
        }
        // 获取元素
        return dequeue();
    } finally {
        lock.unlock();
    }
}
```

我们发现`poll()`、`take()`和`poll（long timeout，TimeUnit unit）`方法和核心都是`dequeue()`方法，那么接下来我们就看看`dequeue()`方法到底做了写什么。

```java
private E dequeue() {
    final Object[] items = this.items;
    @SuppressWarnings("unchecked")
    // 获取takeIndex位置上的元素，默认情况下takeIndex为0
    E x = (E) items[takeIndex];
    // 将takeIndex位置上的元素置为null
    items[takeIndex] = null;
    // 判断takeIndex是不是最后一个位置，如果是则把takeIndex置为0
    if (++takeIndex == items.length)
        takeIndex = 0;
    //队列中的元素减一
    count--;
    // 迭代器不为空，维护迭代器
    if (itrs != null)
        itrs.elementDequeued();
    // 唤醒入列的线程
    notFull.signal();
    return x;
}
```

该方法逻辑很清晰，即从队列头takeIndex位置处获取元素，并将该位置置位null。如果取得的最后一个元素，则将takeIndex置为0。然后唤醒在入列过程中阻塞的线程。

**peek()方法：**

`peek()`方法的目的是查看队列头元素，但是它并不会将该元素从队列中去掉。其源码如下：

```java
public E peek() {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        return itemAt(takeIndex); // null when queue is empty
    } finally {
        lock.unlock();
    }
}
final E itemAt(int i) {
    return (E) items[i];
}
```

到此我们分析完了ArrayBlcokingQueue中入列和出列的全部方法。可以看出ArrayBlockingQueue入列和出列的逻辑还是比较简单的。下一篇LZ将分析右链表结果组成的有界队列LinkedBlockingQueue。



