---
title: JUC阻塞队列之LinkedBlockingQueue源码分析
tags:
  - Java
  - 线程
  - LinkedBlockingQueue
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: source-code-analysis-of-linkedblockingqueue-of-juc-blocking-queue
original: true
show_title: juc-linkedBlockingQueue
date: 2019-10-08 14:16:16
---

LinkedBlockingQueue与ArrayBlockingQueue相对应也是一个有界队列并且同样遵守先进先出规则(FIFO)，它的默认和最大长度为`Integer.MAX_VALUE`，从名称可以得知，LinkedBlockingQueue底层是有链表实现的。下面我们对LinkedBlockingQueue的源码进行分析。

在分析LinkedBlockingQueue之前，我们先来了解一下LinkedBlockingQueue中几个重要的成员变量。

```java
//链表的节点
static class Node < E > {
    E item;
    // 后继节点
    Node < E > next;
    Node(E x) { item = x; }
}
//队列容量，默认为Integer.MAX_VALUE
private final int capacity;
//队列中元素的个数
private final AtomicInteger count = new AtomicInteger();
//队列头结点
transient Node<E> head;
//队列尾节点
private transient Node<E> last;
//take或者poll操作持有的锁
private final ReentrantLock takeLock = new ReentrantLock();
//等待队列条件
private final Condition notEmpty = takeLock.newCondition();
//put或者offer操作持有的锁
private final ReentrantLock putLock = new ReentrantLock();
//等待队列条件
private final Condition notFull = putLock.newCondition();
```

从上面成员变量中我们发现队列中拥有两把锁，一个是`take`和`poll`操作用到的锁，一个是`put`和`offer`操作用到的锁，它是“双锁队列”算法的变体。而`count`成员变量维护成了成了一个原子字段，以避免在大多数情况下需要同时获取这两个锁。在看了这些重要的成员变量后，我们在来分析LinkedBlockingQueue的构造函数。

###  构造函数

LinkedBlockingQueue提供了3种构造方法，它们分别如下：

1. 方式一：默认构造函数

    ```java
    public LinkedBlockingQueue() {
    	//默认队列的长度为Integer.MAX_VALUE
        this(Integer.MAX_VALUE);
    }
    ```

    默认构造函数设置队列长度为Integer.MAX_VALUE

2. 方式二：给定初始长度构造

    ```java
    //初始容量capacity
    public LinkedBlockingQueue(int capacity) {
    	//检查参数
        if (capacity <= 0) throw new IllegalArgumentException();
        this.capacity = capacity;
        //构建头结点和尾节点都指向一个空节点
        last = head = new Node < E > (null);
    }
    ```

    默认初始头结点和尾节点指向一个空节点

3. 方式三：给定集合构造一个LinkedBlockingQueue

    ```java
    public LinkedBlockingQueue(Collection < ? extends E > c) {
    	//默认给定长度
        this(Integer.MAX_VALUE);
        //获取重入锁
        final ReentrantLock putLock = this.putLock;
        //加锁
        putLock.lock(); // Never contended, but necessary for visibility
        try {
        	//将集合C中的元素添加到队列中
            int n = 0;
            for (E e: c) {
                if (e == null)
                    throw new NullPointerException();
                if (n == capacity)
                    throw new IllegalStateException("Queue full");
                //向队列中添加元素  
                enqueue(new Node < E > (e));
                ++n;
            }
            count.set(n);
        } finally {
        	//释放锁
            putLock.unlock();
        }
    }
    ```

    此构造函数的作用就是将传入的集合c中的元素添加到LinkedBlockingQueue队列中去。添加元素方法`enqueue`我们在后面进行分析。

### LinkedBlockingQueue入列操作

LinkedBlockingQueue提供了3中入列操作，他们分别是：

* `put(E e) :`阻塞的向队列中插入元素，如果队列已满，则阻塞线程
* ` offer(E e, long timeout, TimeUnit unit):`等待超时的向队列中插入元素，如果超时则返回false
* `offer(E e):`不阻塞的向队列中插入元素，如果队列已满，则返回false。插入成功返回true

下面我们来分析这几个入列操作

##### put(E e)操作:

上面已经分析了put操作会阻塞线程，其元素如下：

```java
public void put(E e) throws InterruptedException {
    //检查元素是否为null
    if (e == null) throw new NullPointerException();
    int c = -1;
    //构建节点
    Node < E > node = new Node < E > (e);
    //获取锁
    final ReentrantLock putLock = this.putLock;
    //获取队列中元素的个数
    final AtomicInteger count = this.count;
    //获取锁
    putLock.lockInterruptibly();
    try {
        //判断队列是否已满
        //这里用while不用if是因为线程从await醒来后，需要再次判断队列是否已经满
        while (count.get() == capacity) {
            //如果队列已满，则进入等待队列等待
            notFull.await();
        }
        //队列未满，向队列中添加元素
        enqueue(node);
        //返回count中每自加之前的值
        c = count.getAndIncrement();
        //判断元素是否已满
        if (c + 1 < capacity)
            //唤醒其它等待的线程
            notFull.signal();
    } finally {
        //释放锁
        putLock.unlock();
    }
    if (c == 0)
        //通知出列操作
        signalNotEmpty();
}

private void signalNotEmpty() {
    final ReentrantLock takeLock = this.takeLock;
    takeLock.lock();
    try {
        notEmpty.signal();
    } finally {
        takeLock.unlock();
    }
}
```

`put`操作的逻辑比较简单，首先判断参数是否合法，然后获取锁，获取锁后，判断队列是否已满，如果已满则进入等待队列等待，如果没有满则将元素添加到队列中去。之后再判断队列是否已满，如果未满则唤醒其它put或offer阻塞的线程。最后通知出列操作的线程，有元素可以出列。

##### offer(E e)操作：

`offer（E e）`操作为线程不阻塞的操作，在队列已满的情况下回直接返回false，其源码如下：

```java
public boolean offer(E e) {
	//检查元素合法性
    if (e == null) throw new NullPointerException();
    //获取队列中元素的个数
    final AtomicInteger count = this.count;
    //若果队列满了，则返回false
    if (count.get() == capacity)
        return false;
    int c = -1;
    //构建node节点
    Node < E > node = new Node < E > (e);
    //获取锁
    final ReentrantLock putLock = this.putLock;
    putLock.lock();
    try {
    	//判断队列是否已经满了
        if (count.get() < capacity) {
        	//添加节点
            enqueue(node);
            c = count.getAndIncrement();
            //唤醒其它入列操作阻塞的线程
            if (c + 1 < capacity)
                notFull.signal();
        }
    } finally {
    	//释放锁
        putLock.unlock();
    }
    if (c == 0)
    	//通知出列操作的线程
        signalNotEmpty();
    return c >= 0;
}
```

`offer(E e)`操作和`put`操作非常相似，只是它没有阻塞的环节，其它的一样。

##### offer(E e, long timeout, TimeUnit unit)操作：

超时等待，即在一定时间内阻塞，超过这个时间后直接返回。其源码如下：

```java
public boolean offer(E e, long timeout, TimeUnit unit) throws InterruptedException {
	//检查元素的合法性
    if (e == null) throw new NullPointerException();
    //获取要等待的时间nanos纳秒
    long nanos = unit.toNanos(timeout);
    int c = -1;
    final ReentrantLock putLock = this.putLock;
    //获取队列中元素的个数
    final AtomicInteger count = this.count;
    //获取锁
    putLock.lockInterruptibly();
    try {
    	//如果队列已满
        while (count.get() == capacity) {
        	//如果已经超时，则返回false
            if (nanos <= 0)
                return false;
            //否则进行等待指定时间
            nanos = notFull.awaitNanos(nanos);
        }
        //若果队列未满，则将元素添加到队列中去
        enqueue(new Node < E > (e));
        c = count.getAndIncrement();
        if (c + 1 < capacity)
        	//唤醒其它入列等待的线程
            notFull.signal();
    } finally {
    	//释放锁
        putLock.unlock();
    }
    if (c == 0)
    	//唤醒出列阻塞的线程
        signalNotEmpty();
    return true;
}
```

`offer(E e, long timeout, TimeUnit unit)`方法与`put`方法也非常相似，只是该方法只阻塞timeout时间，如果时间到了则会返回不会继续阻塞。

上面3个入列操作的核心方法都是`enqueue`方法，我们看看该方法源码。

```java
private void enqueue(Node < E > node) {
    //将node节点指向为last的next
    last = last.next = node;
}
```

`enqueue`方法非常简单，即将新构建的节点node指向last的next域，然后更新last节点指向为node节点。这里没有用锁的原因是调用该方法时必须获取到了锁。

### LinkedBlockingQueue出列操作

LinkedBlockingQueue同样提供了3个出列操作，它们分别是：

* `take():`阻塞式的出列，如果队列为空，即线程进入等待队列等待
* `poll(long timeout, TimeUnit unit):`超时等待出列，若果队列为空，那么线程等待指定时长，超过指定时长后立即返回
* `E poll():`简单的处理，如果队列为空，则返回false

下面我们来对这几个出列操作进行分析。

##### take()出列操作:

`take()`源码定义如下：

```java
public E take() throws InterruptedException {
    E x;
    int c = -1;
    //获取队列中元素总数
    final AtomicInteger count = this.count;
    //获取take、poll 操作的锁
    final ReentrantLock takeLock = this.takeLock;
    //加锁
    takeLock.lockInterruptibly();
    try {
        //若果队列为空，则线程进入等待队列阻塞
        while (count.get() == 0) {
            notEmpty.await();
        }
        //从队列中获取元素
        x = dequeue();
        //1、获取取出元素之前队列中元素的个数
        //2、将count的值建一
        c = count.getAndDecrement();
        //若果队列中还曾在元素，则唤醒其它出列操作阻塞的线程
        if (c > 1)
            notEmpty.signal();
    } finally {
        //释放锁
        takeLock.unlock();
    }
    //若果队列中没有元素了，则唤醒入列操作阻塞的线程
    if (c == capacity)
        signalNotFull();
    return x;
}
```

`take()`操作的逻辑比较简单，上面注释已经写的比较清楚了。出列操作的核心方法dequeue在看我所有出列操作的方法再来分析。

##### poll(long timeout, TimeUnit unit)出列操作：

```java
public E poll(long timeout, TimeUnit unit) throws InterruptedException {
    E x = null;
    int c = -1;
    //指定等待nanos纳秒
    long nanos = unit.toNanos(timeout);
    //获取队列中元素的个数
    final AtomicInteger count = this.count;
    //获取出列操作的锁
    final ReentrantLock takeLock = this.takeLock;
    //加锁
    takeLock.lockInterruptibly();
    try {
        //若果队列为空，则阻塞nanos纳秒
        //时间超过nanos纳秒后，直接返回false
        while (count.get() == 0) {
            if (nanos <= 0)
                return null;
            nanos = notEmpty.awaitNanos(nanos);
        }
        //若果队列不为空，则出列
        x = dequeue();
        //1、获取取出元素之前队列中元素的个数
        //2、将count的值建一
        c = count.getAndDecrement();
        //若果队列中还曾在元素，则唤醒其它出列操作阻塞的线程
        if (c > 1)
            notEmpty.signal();
    } finally {
        //释放锁
        takeLock.unlock();
    }
    ////若果队列中没有元素了，则唤醒入列操作阻塞的线程
    if (c == capacity)
        signalNotFull();
    return x;
}
```

等待超时的处理操作也是比价简单的，看上面注释就能理解。

##### poll()处理操作：

`poll()`处理相比于上面两种出列操作更简单，因为它不会阻塞，在队列没有元素时，会直接返回null。我们来看看其源码定义：

```java
public E poll() {
    //获取队列中元素的个数
    final AtomicInteger count = this.count;
    //若果队列中没有元素，则返回null
    if (count.get() == 0)
        return null;
    E x = null;
    int c = -1;
    //获取出列类型的锁
    final ReentrantLock takeLock = this.takeLock;
    //加锁
    takeLock.lock();
    try {
        //若果队列中有元素则获取元素
        //获取元素后，如果队列中还曾在元素，则通知其它阻塞的处理操心线程
        if (count.get() > 0) {
            x = dequeue();
            c = count.getAndDecrement();
            if (c > 1)
                notEmpty.signal();
        }
    } finally {
        //释放锁
        takeLock.unlock();
    }
    //若果队列中没有元素，则唤醒入列操作的线程
    if (c == capacity)
        signalNotFull();
    return x;
}
```

这里出列操作就都分享完成，下面我们来看看其核心方法`dequeue`，源码如下：

```java
private E dequeue() {
    //获取头结点
    Node < E > h = head;
    //第一个节点
    Node < E > first = h.next;
    //将h的next指向自己
    h.next = h; // help GC
    //将head指向第一节点
    head = first;
    //获取第一个节点的值
    E x = first.item;
    //将第一节点的值设置为null
    first.item = null;
    return x;
}
```

出队列时，先将head节点的next指向自己，然后将head指向第一个节点，获取第一个节点的元素后将其设置为null,最后返回。

### LinkedBlockingQueue查看头结点元素

LinkedBlockingQueue提供了查看头结点元素的方法，其源码如下：

```java
public E peek() {
    //若果队列中没有元素，则返回null
    if (count.get() == 0)
        return null;
    //获取出队列操作的锁
    final ReentrantLock takeLock = this.takeLock;
    takeLock.lock();
    try {
        //获取第一个节点
        Node < E > first = head.next;
        //如果第一个节点为null,则返回null
        if (first == null)
            return null;
        else
            //返回第一个节点的值
            return first.item;
    } finally {
        //释放锁
        takeLock.unlock();
    }
}
```

`peek`操作和出列操作的不同在于，出列操作会将节点移除，而`peek`操作只是查看队列头结点的值，而不会将节点移出队列。

### LinkedBlockingQueue删除操作

LinkedBlockingQueue提供了删除指定内容的操作，其源码定义如下：

```java
/**
 * 删除指定对象
 * @param  o [要删除的对象]
 * @return   [删除成功返回true，删除失败返回false]
 */
public boolean remove(Object o) {
    //如果要删除的对象为null,返回false
    if (o == null) return false;
    //获取到入列操作的锁同样获取到出列操作的锁
    //在remove操作时，不能进行入列和出列的操作
    fullyLock();
    try {
        //从头部开始变量节点
        for (Node < E > trail = head, p = trail.next; p != null; trail = p, p = p.next) {
            //如果在队列中找到了知道删除的对象，则将该节点删除并返回true
            if (o.equals(p.item)) {
                unlink(p, trail);
                return true;
            }
        }
        //否则返回false
        return false;
    } finally {
        //释放锁
        fullyUnlock();
    }
}

/**
 * 删除节点
 * @param p     [要删除的节点]
 * @param trail [待删除节点的前驱节点]
 */
void unlink(Node < E > p, Node < E > trail) {
    //将待删除节点的item设置成null
    p.item = null;
    //将p的next赋值给trail的next,即端口了p节点
    trail.next = p.next;
    //如要待删除的节点是尾节点，则将p节点的前驱节点设置成新的尾节点
    if (last == p)
        last = trail;
    //删除节点后唤醒入列操作的线程
    if (count.getAndDecrement() == capacity)
        notFull.signal();
}
```

`remove()`方法逻辑比较简单，唯一需要注意的就是该操作需要同时获取入列锁和出列锁。因此删除操作需要阻塞整个队列，在做删除操作时，即不能入列也不能出列。

### 总结

LinkedBlockingQueue的入列、出列和删除节点的逻辑都比较简单。它与ArrayBlockingQueue的逻辑几乎一致，这里我们对ArrayBlockingQueue和LinkedBlockingQueue做一个异同总结：

* 相同：
    * ArrayBlockingQueue和LinkedBlockingQueue都是有界阻塞队列，并且都是线程安全的。
    * ArrayBlockingQueue和LinkedBlockingQueue都遵守先进先出(FIFO)原则。
    * ArrayBlockingQueue和LinkedBlockingQueue都实现了BlockingQueue接口。
    * ArrayBlockingQueue和LinkedBlockingQueue都是基于ReentrantLock和Condition来保证生产和消费的同步。
* 不同：
    * ArrayBlockingQueue内部使用数组实现，LinkedBlockingQueue内部使用链表实现。
    * ArrayBlockingQueue在构造时需要传递初始容量大小，LinkedBlockingQueue在构造时可以不知道初始容量，当不指定初始容量时，其大小默认为Integer.MAX_VALUE。
    * ArrayBlockingQueue中锁是没有分离的，LinkedBlockingQueue中的锁是分离的，即生产用的是putLock，消费是takeLock。



