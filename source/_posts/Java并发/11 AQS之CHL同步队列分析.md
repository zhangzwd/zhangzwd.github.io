---
title: AQS之CHL同步队列分析
tags:
  - Java
  - 线程
  - AQS
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: analysis-of-chl-synchronous-queue-of-aqs
show_title: aqs-chl-synchronization-queue-analysis
original: true
date: 2019-08-28 14:30:43
---
### AQS之CHL同步队列分析
上一章LZ在分析AQS的工作原理时，使用了一张图来解释了AQS独占模式的工作原理，在图中LZ画了一个CHL同步队列，这个CHL同步队列就是AQS内部维护的一个FIFO双向队列。AQS依赖这个双向队列来完成同步状态的管理。如果当前线程获取同步状态失败，AQS将会将当前线程以及等待状态信息构建成一个节点（Node）并将其加入到同步队列中，同时会阻塞当前线程。当同步状态释放时，会把首节点中的线程唤醒，使其再次获取同步状态。
在CHL中节点（Node）用来保存获取同步状态失败的线程（thread）、等待状态（waitStatus）、前驱节点（prev）和后继节点（next）。
AQS中内部维护的Node节点源码如下：

```java
static final class Node {
    /** 表示节点正在共享模式中等待 */
    static final Node SHARED = new Node();
    /** 表示节点正在独占模式下等待 */
    static final Node EXCLUSIVE = null;

    /** 
    * 表示线程已经被取消 
    * 同步队列中的线程因为超时或中断，需要从同步队列中取消。被取消的节点将不会有任何改变
    */
    static final int CANCELLED = 1;
    
    
    /** 
    * 后继节点的线程处于等待状态，而当前节点的线程如果释放了同步状态或者被取消，将会通知后
    * 继节点，使后继节点的线程得以运行 
    */
    static final int SIGNAL = -1;
    
    
    /** 
      * 节点在等待队列中，节点线程等待在Condition上，当其他线程对Condition调用了signal()方法 
     *  后，该节点将会将等待队列中转移到同步队列中，加入到对同步状态的获取 
     */
    static final int CONDITION = -2;
    
    
    /**
     * 下一次共享模式同步状态获取将会无条件的被传播下去
     */
    static final int PROPAGATE = -3;
    
    

    /**
     *   等待状态，仅接受如下状态中的一个值：
     *   SIGNAL:  -1
     *   CANCELLED:   1
     *   CONDITION:   -2
     *   PROPAGATE:   -3
     *   0:  初始化的值
     *
     * 对于正常的同步节点，它的初始化值为0，对于条件节点它的初始化的值是CONDITION。它使用
     * CAS进行修改。
     */
    volatile int waitStatus;

    /**
     *  前驱节点
     */
    volatile Node prev;

    /**
     * 后继节点
     */
    volatile Node next;

    /**
     * 获取同步状态的线程
     */
    volatile Thread thread;

    /**
     * 等待队列中的后继节点。如果当前节点是共享的，那么这个字段是一个SHARED常量，也就是说
     * 节点类型（独占和共享）和等待队列中的后继节点公用同一个字段
     */
    Node nextWaiter;

    /**
     * 如果节点在共享模式下等待则返回true
     */
    final boolean isShared() {
        return nextWaiter == SHARED;
    }

    /**
     * 获取前驱节点
     */
    final Node predecessor() throws NullPointerException {
        Node p = prev;
        if (p == null)
            throw new NullPointerException();
        else
            return p;
    }

    Node() {
    }

    Node(Thread thread, Node mode) { 
        this.nextWaiter = mode;
        this.thread = thread;
    }

    Node(Thread thread, int waitStatus) { 
        this.waitStatus = waitStatus;
        this.thread = thread;
    }
}

```

节点（Node）是构成CHL的基础，同步器拥有首节点（head）和尾节点（tail）,没有成功获取同步状态的线程会构建成一个节点并加入到同步器的尾部。CHL的基本结构如下：
![CHL基本结构](http://cdn.zzwzdx.cn/blog/CHL基本结构.png&blog)

图中：**compareAndSetTail(Node expect,Node update)** 方法是同步器为了保证线程安全的加入到CHL的尾部提供的一个基于CAS算法的方法。


### 入列
从数据结构上出发，入列是比较简单的，无非就是当前队列中的尾节点指向新节点，新节点的prev指向队列中的尾节点，然后将同步器的tail节点指向新节点。在AQS中入列的源码如下：
```java

/**
 * 为当前线程和给定的模式创建节点并计入到同步队列中
 *
 * @param mode Node.EXCLUSIVE for exclusive, Node.SHARED for shared
 * @return the new node
 */
private Node addWaiter(Node mode) {
    // 创建一个节点
    Node node = new Node(Thread.currentThread(), mode);
    // 快速尝试添加尾节点，如果失败则调用enq(Node node)方法设置尾节点
    Node pred = tail;
    // 判断tail节点是否为空，不为空则添加节点到队列中
    if (pred != null) {
        node.prev = pred;
        // CAS设置尾节点
        if (compareAndSetTail(pred, node)) {
            pred.next = node;
            return node;
        }
    }
    enq(node);
    return node;
}

/**
 * 插入节点到队列中
 * @param node the node to insert
 * @return node's predecessor
 */
private Node enq(final Node node) {
    // 死循环 直到将节点插入到队列中为止
    for (;;) {
        Node t = tail;
        // 如果队列为空，则首先添加一个空节点到队列中
        if (t == null) {
            if (compareAndSetHead(new Node()))
                tail = head;
        } else {
            // tail 不为空，则CAS设置尾节点
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}

```
从上面源码中我们可以看到，在将节点添加到CHL尾部的时候，使用了一个CAS方法（`compareAndSetTail(pred, node)`）,这里使用CAS的原因是防止在并发添加尾节点的时候出现线程不安全的问题（即有可能出现遗漏节点的情况）。

CHL入列的过程如下：

![CHL入列的过程](http://cdn.zzwzdx.cn/blog/CHL入列的过程.png&blog)


### 出列
同步队列遵循FIFO规范，首节点的线程在释放同步状态后，将会唤醒后继节点的线程，并且后继节点的线程在获取到同步状态后将会将自己设置为首节点。因为设置首节点是通过获取同步状态成功的线程来完成的，因此设置头结点的方法并不需要使用CAS来保证，因为只有一个线程能获取到同步状态。CHL出列的过程如下：
![CHL出列的过程](http://cdn.zzwzdx.cn/blog/CHL出列的过程.png&blog)
