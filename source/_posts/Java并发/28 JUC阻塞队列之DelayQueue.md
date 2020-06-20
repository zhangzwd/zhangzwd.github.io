---
title: JUC阻塞队列之DelayQueue源码分析
tags:
  - Java
  - 线程
  - delayQueue
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: source-code-analysis-of-delayqueue-of-juc-blocking-queue
original: true
show_title: juc-delayQueue
date: 2019-10-20 13:38:55
---
DelayQueue是一个支持延时获取元素的无界阻塞队列。并且队列中的元素必须实现Delayed接口。在创建元素时可以指定多久才能从队列中获取当前元素。只有在延迟期满时才能从队列中获取到元素。DelayQueue的应用范围非常广阔，如可以用它来保存缓存中元素的有效期，也可用它来实现定时任务。

DelayQueue是一个支持延时获取元素的无界阻塞队列。并且队列中的元素必须实现Delayed接口。在创建元素时可以指定多久才能从队列中获取当前元素。只有在延迟期满时才能从队列中获取到元素。DelayQueue的应用范围非常广阔，如可以用它来保存缓存中元素的有效期，也可用它来实现定时任务。

#### Delayed接口

在分析DelayQueue源码之前，我们先来看看Delayd接口，其源码定义如下：

```java
public interface Delayed extends Comparable < Delayed > {

    /**
     * 指定返回对象的延时时间
     * @param  unit [时间单位]
     * @return      [延时的剩余，0或者-1表示延时已经过期]
     */
    long getDelay(TimeUnit unit);
}
```

我们看到，Delayed接口继承了Comparable接口，即实现Delayed接口的对象必须实现`getDelay(TimeUnit unit)`方法和`compareTo(T o)`方法。这里`compareTo(T o)`方法可以用来实现元素的排序，可以将延时时间长的放到队列的末尾。

#### DelayQueue构造函数

上面分析了Delayed接口，接下来我们分析DelayQueue的构造函数。DelayQueue提供了2种构造函数，一个是无参构造函数，一个是给定集合为参数的构造函数。其源码如下：

```java
 /**
  * 构建一个空的DelayQueue
  */
 public DelayQueue() {}

 /**
  * 给定集合c为参数的构造函数
  * 将集合c中的元素全部放入到DelayQueue中
  */
 public DelayQueue(Collection < ? extends E > c) {
     this.addAll(c);
 }
```

`addAll`方法是AbstractQueue抽象类中的方法，其源码如下：

```java
public boolean addAll(Collection < ? extends E > c) {
    // 参数检测
    if (c == null)
        throw new NullPointerException();
    if (c == this)
        throw new IllegalArgumentException();
    boolean modified = false;
    //遍历集合c中的元素
    for (E e: c)
        // 调用DelayQueue中的add方法
        if (add(e))
            modified = true;
    return modified;
}
```

从上面的源码中，我们可以看到，AbstractQueue抽象类中`addAll`方法实际是调用DelayQueue类中的`add`方法来实现的。

#### DelayQueue 入列操作

DelayQueue提供了4种入列操作，分别是：

* `add(E e):`阻塞的将指定元素添加到延时队列中去，因为队列是无界的因此此方法永不阻塞。
* `offer(E e):`阻塞的将指定元素添加到延时队列中去，因为队列是无界的因此此方法永不阻塞。
* `put(E e):`阻塞的将指定元素添加到延时队列中去，因为队列是无界的因此此方法永不阻塞。
* `offer(E e, long timeout, TimeUnit unit):`阻塞的将指定元素添加到延时队列中去，因为队列是无界的因此此方法永不阻塞。

这里大家可能会奇怪，为什么这些入列方法的解释都是一样的？这个问题先等下回答，我们先来看看这几个入列方法的源码定义：

```java
public boolean add(E e) {
    return offer(e);
}

public boolean offer(E e) {
    //获取可重入锁
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lock();
    try {
        //调用PriorityQueue中的offer方法
        q.offer(e);
        //调用PriorityQueue中的peek方法
        if (q.peek() == e) {
            leader = null;
            available.signal();
        }
        return true;
    } finally {
        //释放锁
        lock.unlock();
    }
}

public void put(E e) {
    offer(e);
}

public boolean offer(E e, long timeout, TimeUnit unit) {
    return offer(e);
}
```

这里我们从源码中可以看到，`add(E e)`方法、`put(E e)`方法和`offer(E e,long timeout,TimeUnit unit)`方法都是调用`offer(E e)`方法来实现的，这也是为什么这几个方法的解释都是一样的原因。其中`offer(E e)`方法的核心又是调用了PriorityQueue中的`offer(E e)`方法，PriorityQueue和PriorityBlockingQueue都是以二叉堆的无界队列，只不过PriorityQueue不是阻塞的而PriorityBlockingQueue是阻塞的。前面分析过PriorityBlockingQueue的源码，这里就不在重复赘述了。

#### DelayQueue出列操作

DelayQueue提供了3种出列操作方法，它们分别是：

* `poll():`检索并删除此队列的开头，如果此队列没有延迟的元素，则返回null
* `take():`检索并除去此队列的头，如有必要，请等待直到该队列上具有过期延迟的元素可用。
* `poll(long timeout, TimeUnit unit):`检索并删除此队列的头，如有必要，请等待直到该队列上具有过期延迟的元素可用，或者或指定的等待时间到期。

下面我们来一个一个分析出列操作的原来。

##### poll

poll操作的源码定义如下：

```java
 public E poll() {
    //获取可重入锁
     final ReentrantLock lock = this.lock;
     //加锁
     lock.lock();
     try {
        //获取队列中的第一个元素
         E first = q.peek();
         //如果元素为null,或者头元素还未过期，则返回false
         if (first == null || first.getDelay(NANOSECONDS) > 0)
             return null;
         else
            //调用PriorityQueue中的出列方法
             return q.poll();
     } finally {
         lock.unlock();
     }
 }
```

该方法与PriorityQueue的poll方法唯一的区别就是多了`if (first == null || first.getDelay(NANOSECONDS) > 0)`这个条件判断，该条件是表示如果队列中没有元素或者队列中的元素未过期，则返回null。

##### take

take操作源码定义如下：

```java
public E take() throws InterruptedException {
    final ReentrantLock lock = this.lock;
    //加锁
    lock.lockInterruptibly();
    try {
    	//西循环
        for (;;) {
        	//查看队列头元素
            E first = q.peek();
            //如果队列头元素为null,则表示队列中没有数据，线程进入等待队列
            if (first == null)
                available.await();
            else {
            	// 获取first元素剩余的延时时间
                long delay = first.getDelay(NANOSECONDS);
                //如果剩余延时时间<=0 表示元素已经过期，可以从队列中获取元素
                if (delay <= 0)
                	//直接返回头部元素
                    return q.poll();
                //如果剩余延时时间>0，表示元素还未过期，则将first置为null,防止内存溢出
                first = null; // don't retain ref while waiting
                //如果leader不为null，则直接进入等待队列中等待
                if (leader != null)
                    available.await();
                else {
                	//如果leader为null,则把当前线程赋值给leader，并超时等待delay纳秒
                    Thread thisThread = Thread.currentThread();
                    leader = thisThread;
                    try {
                        available.awaitNanos(delay);
                    } finally {
                        if (leader == thisThread)
                            leader = null;
                    }
                }
            }
        }
    } finally {
        if (leader == null && q.peek() != null)
        	//唤醒线程
            available.signal();
        lock.unlock();
    }
}
```

`take`操作比`poll`操作稍微要复杂些，但是逻辑还是相对比较简单。只是在获取元素的时候先检查元素的剩余延时时间，如果剩余延时时间<=0,则直接返回队列头元素。如果剩余延时时间>0，则判断leader是否为null，如果leader不为null，则表示已经有线程在等待获取队列的头部元素，因此直接进入等待队列中等待。如果leader为null，则表示这是第一个获取头部元素的线程，把当前线程赋值给leader，然后超时等待剩余延时时间。在`take`操作中需要注意的一点是`fist=null`，因为如果first不置为null的话会引起内存溢出的异常，这是因为在并发的时候，每个线程都会持有一份first，因此first不会被释放，如果线程数过多，就会导致内存溢出的异常。

##### poll(long timeout, TimeUnit unit)

超时等待获取队列元素的源码如下：

```java
public E poll(long timeout, TimeUnit unit) throws InterruptedException {
    long nanos = unit.toNanos(timeout);
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        for (;;) {
            E first = q.peek();
            if (first == null) {
                if (nanos <= 0)
                    return null;
                else
                    nanos = available.awaitNanos(nanos);
            } else {
                long delay = first.getDelay(NANOSECONDS);
                if (delay <= 0)
                    return q.poll();
                if (nanos <= 0)
                    return null;
                first = null; // don't retain ref while waiting
                if (nanos < delay || leader != null)
                    nanos = available.awaitNanos(nanos);
                else {
                    Thread thisThread = Thread.currentThread();
                    leader = thisThread;
                    try {
                        long timeLeft = available.awaitNanos(delay);
                        nanos -= delay - timeLeft;
                    } finally {
                        if (leader == thisThread)
                            leader = null;
                    }
                }
            }
        }
    } finally {
        if (leader == null && q.peek() != null)
            available.signal();
        lock.unlock();
    }
}
```

这个出列操作的逻辑和`take`出列操作的逻辑几乎一样，唯一不同的在于`take`是无时间限制等待，而改操作是超时等待。

### 总结

DelayQueue的入列和出列操作逻辑相对比较简单，就是在获取元素的时候，判断元素是否已经过期，如果过期就可以直接获取，没有过期的话`poll	`操作是直接返回null，`take`操作是进入等待队列中等待。

