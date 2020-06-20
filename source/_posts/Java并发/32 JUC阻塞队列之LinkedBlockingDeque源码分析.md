---
title: JUC阻塞队列之LinkedBlockingDeque源码分析
tags:
  - Java
  - 线程
  - LinkedBlockingDeque
copyright: true
categories:
  - Java并发编程
special: JUC
original: true
show_title: juc-linkedBlockingDeque
translate_title: source-code-analysis-of-linkedblockingdeque-of-juc-blocking-queue
date: 2020-02-18 12:22:52
---

LinkedBlockingDeque从名称中我们可以得知，他是一个由链表结构组成的双向阻塞队列。  相比其他的阻塞队列，LinkedBlockingDeque多了addFirst、addLast、offerFirst、offerLast、peekFirst和peekLast等方法，以First单词结尾的方法，表示插入、获取（peek）或移除双端队列的第一个元素。以Last单词结尾的方法，表示插入、获取或移除双端队列的最后一个元素。另外，插入方法add等同于addLast，移除方法remove等效于removeFirst。但是take方法却等同于takeFirst。  

### LinkedBlockingDeque构造函数

LinkedBlockingDeque提供了3中构造函数，分别是默认构造函数，指定长度构造函数和指定集合的构造函数。其定义分别如下：

```java
// 默认构造函数
public LinkedBlockingDeque() {
    this(Integer.MAX_VALUE);
}

// 指定长度构造函数
public LinkedBlockingDeque(int capacity) {
	// 检查长度合法性
    if (capacity <= 0) throw new IllegalArgumentException();
    this.capacity = capacity;
}

// 指定集合的构造函数
public LinkedBlockingDeque(Collection < ? extends E > c) {
	// 初始化容量大小
    this(Integer.MAX_VALUE);
    // 加可重入锁
    final ReentrantLock lock = this.lock;
    lock.lock(); // Never contended, but necessary for visibility
    try {
        for (E e: c) {
            if (e == null)
                throw new NullPointerException();
            // 想队列尾部添加元素
            if (!linkLast(new Node < E > (e)))
                throw new IllegalStateException("Deque full");
        }
    } finally {
        lock.unlock();
    }
}
```

### 入列操作

LinkedBlockingDeque提供了好几个入列方法，不过其入列的实现基本相似，这里我们就以`putFirst`方法为例来说明LinkedBlockingDeque的入列操作。`putFirst`方法的源码如下：

```java
public void putFirst(E e) throws InterruptedException {
    // 元素不能为null
    if (e == null) throw new NullPointerException();
    // 构建新节点
    Node < E > node = new Node < E > (e);
    // 获取锁
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        // 将节点添加到队列头部，如果失败则等待在notFull条件上
        while (!linkFirst(node))
            notFull.await();
    } finally {
        lock.unlock();
    }
}

private boolean linkFirst(Node < E > node) {
    // 判断队列是否已满
    if (count >= capacity)
        return false;
    // 获取first节点
    Node < E > f = first;
    // 将first节点赋值给node的next域
    node.next = f;
    // 将node节点赋值给first
    first = node;
    // 如果last==null,则将last也指向node
    if (last == null)
        last = node;
    else
        // 如果last不为null，则将原头结点的prev域设置为node
        f.prev = node;
    // 节点自增
    ++count;
    // 唤醒等待在notEmpty条件上的线程
    notEmpty.signal();
    return true;
}
```

### 出列操作

同样我们也已`takeFirst`方法为例，来说明LinkedBlockingDeque的处理操作。其定义如下：

```java
public E takeFirst() throws InterruptedException {
    // 获取锁
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        E x;
        // 如果x==null，则将线程等待在notEmpty条件上
        while ((x = unlinkFirst()) == null)
            notEmpty.await();
        // 否则返回x
        return x;
    } finally {
        // 释放锁
        lock.unlock();
    }
}

private E unlinkFirst() {
    // 获取头结点
    Node < E > f = first;
    // 若头结点为null,则直接返回null
    if (f == null)
        return null;
    // 获取头结点的下一个节点n
    Node < E > n = f.next;
    // 获取头结点的值
    E item = f.item;
    // 将头结的值设置为null
    f.item = null;
    // 将头结点的next设置为自身
    f.next = f; 
    // 将first 指向 n
    first = n;
    // 如果n==null,则表示队列为空，则将last节点也设置为null
    if (n == null)
        last = null;
    else
        // 否则将头结点的前驱节点设置为null 
        n.prev = null;
    // 队列中总数减一
    --count;
    // 唤醒等待在notFull条件上的线程
    notFull.signal();
    return item;
}
```

LinkedBlockingDeque入列和出列的逻辑都比较简单，只要注意节点的指向就行。LinkedBlockingDeque底层结构如下：

![](http://cdn.zzwzdx.cn/blog/结构.png&blog)

### 总结

LinkedBlockingDeque 内部使用了可重入锁（线程安全），不像SynchronousQueue使用的循环cas，因此很简单，出队和入队使用的是同一个锁，但是两头都可以操作队列，相对于单端队列可以减少一半的竞争。LinkedBlockingDeque 同其他阻塞队列一样，不能存储null值元素。
