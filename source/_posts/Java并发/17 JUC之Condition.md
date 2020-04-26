---
title: JUC之Condition源码分析
tags:
  - Java
  - 线程
  - 锁
copyright: true
categories:
  - Java并发编程
translate_title: condition-source-code-analysis-of-juc
special: JUC
original: true
show_title: juc-condition-source
date: 2019-09-09 13:45:31
---

Condition接口定义了类似Object的监视器方法，它与Lock配合能够实现等待/通知模式，我们知道Object类中的wait()与notify()方法与synchronized关键字配合也能实现等待/通知模式,但是这两者在使用方式和功能上是有差别的，下面是Condition和Object监视方法的对比：

![Condition接口与Object监视器方法比对](http://cdn.zzwzdx.cn/blog/Condition接口与Object监视器方法比对.png&blog)

Condition接口提供的方法列表如下：

![Condition接口方法](http://cdn.zzwzdx.cn/blog/Condition接口方法.png&blog)

Condition的实例必须通过Lock.newCondition()方法来获取，下面通过一个简单的示例来看一下Condition的使用方式。

```java
public class ConditionDemo<T> {
    private Object[] items;
    private Lock lock = new ReentrantLock();
    private int count,addIndex,removeIndex;
    private Condition empty = lock.newCondition();
    private Condition full = lock.newCondition();

    public ConditionDemo(int size){
        if(size < 0){
            throw new IllegalArgumentException("size 参数异常!");
        }
        items = new Object[size];
    }
	
    public void add(T t) throws InterruptedException {
        lock.lock();
        try{
            while (count == items.length){
                full.await();
            }
            items[addIndex] = t;
            if(++ addIndex ==  items.length){
                addIndex = 0;
            }
            ++count;
            empty.signalAll();
        }finally {
            lock.unlock();
        }
    }

    public T remove() throws InterruptedException {
        lock.lock();
        try{
            while (count == 0){
                empty.await();
            }
            Object x = items[removeIndex];
            if(++removeIndex == items.length){
                removeIndex = 0;
            }
            --count;
            full.signalAll();
            return (T) x;
        }finally {
            lock.unlock();
        }
    }
}
```

上述代码中，ConditionDemo通过add(T t)添加一个元素，通过remove()删除一个元素。我们从上面代码中可以看到，Condition必须和Lock配合使用才能达到等待/通知的效果。在`add(T t)`方法中，首先获取锁确保items数组的可见性和排他性。当数组的数量等于数组长度时，表示数组已满，调用`full.await()`,当前线程随之释放锁进入等待状态。如果数组数量不等于数组长度，则表示数组未满，向数组中添加一个元素，同时通知等待在empty上的线程，数组中已经存在元素可以获取。`remove()`方法的流程大致与`add(T t)`一样，这里就不在赘述了。

#### Condition的实现

Condition作为一个接口，其下仅有一个实现类ConditionObject，由于Condition的操作需要获取相关的锁，而AQS则是同步锁的实现基础，所以ConditionObject则定义为AQS的内部类。定义如下：

```java
public class ConditionObject implements Condition, java.io.Serializable {
}
```

##### 等待队列

每个Condition对象都包含着一个等待队列，该队列是Condition对象实现等待/通知功能的关键。等待队列是一个FIFO的队列，在队列中每个节点都包含了一个线程，该线程就是等待在Condition对象上的线程，若果一个线程调用了Condition.await()方法，那么该线程将会释放锁，构造成节点加入等待队列并进入等待状态。事实上，节点的定义复用了AQS中节点的定义，也就是说同步队列和等待队列中的节点类型都是AQS中的静态内部类AbstractQueuedSynchronizer.Node。下面代码是ConditionObject在AQS中的定义：

```java
public class ConditionObject implements Condition, java.io.Serializable {
        private static final long serialVersionUID = 1173984872572414699L;
        /** 等待队列中的第一个节点 */
        private transient Node firstWaiter;
        /** 等待登录中的最后一个季度 */
        private transient Node lastWaiter;

        /**
         * Creates a new {@code ConditionObject} instance.
         */
        public ConditionObject() { }

        // ...... 省略方法
```

从上面代码中，我们可以看到Condition中包含了一个首节点（firstWaiter）和一个尾节点（lastWaiter）。当前线程调用await()方法，当前线程将会构造成节点，并添加到等待队列的尾部。等待队列的基本结构如下图所示：

![等待队列的基本结构](http://cdn.zzwzdx.cn/blog/等待队列的基本结构.png&blog)

如图所示，Condition拥有首节点的引用，而新增节点只需要将原尾节点的nextWaiter指向它，并更新尾节点即可。Object监视器的模型上，一个对象拥有一个同步队列和一个等待队列，而并发包中的Lock拥有一个同步队列和多个等待队列。

##### 等待

在当前线程调用Condition中的await()方法时，会使当前线程进入到等待队列并释放锁，同时线程状态变更为等待状态。当线程中await()方法返回时，当前线程一定获取了Condition相关联的锁。从同步队列的角度来看，当调用await()方法时，相当于同步队列的首节点移动到等待队列的队尾。ConditionObject中await()方法的实现如下：

```java
public final void await () throws InterruptedException {
    // 如果线程被中断，则抛出异常
    if (Thread.interrupted())
        throw new InterruptedException();
    // 当前线程加入到等待队列中
    Node node = addConditionWaiter();
    // 释放同步状态，也就是释放锁
    int savedState = fullyRelease(node);
    int interruptMode = 0;
    // 判断节点是否在同步队列中，如果不在同步队列中则将线程挂起，进入阻塞状态
    while (!isOnSyncQueue(node)) {
        // 挂起当前线程，调用次方法后线程会阻塞在这个地方，直到被唤醒或者中断
        LockSupport.park(this);
        // 当线程被唤醒后，判断线程是否已经被中断，若果中断则直接跳转while循环，否则进入再次进入while判断
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
    }
    // 自旋的方式获取同步状态（即获取锁），如果返回true则表示当前线程已经被中断
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null) // clean up if cancelled
        unlinkCancelledWaiters();
    // 处理被中断的情况
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
}
```

这个方法的主要逻辑是首先判断当前线程是否被中断，如果中断了则直接抛出中断异常。如果线程没有被中断，则将当前线程构建成节点添加到等待队列尾部，然后释放当前线程获取的锁（同步状态）并唤醒同步队列中的后续节点，然后当前线程进入等待状态。当等待队列中的节点被唤醒，则唤醒的节点的线程以自旋的方式获取锁（同步状态，这也说明了从await方法中退出必须获取到与Condition相关联的锁）。如果获取同步状态成功，则清理等待队列中不是等待状态的节点并处理中断情况。`await()`方法的逻辑理清了，但是我们还有几个疑问：1、线程是如何加入到等待队列中的？；2、锁释放的过程？；3、怎样才能从await()方法中退出？下面我们来对这3个疑问进行解答。

###### 线程是如何加入到等待队列中的？

从 `await()` 方法的源码中我们看到线程被加入到等待队列中是通过调用`addConditionWaiter()`方法来处理的，我们来看看`addConditionWaiter()`方法的源码定义：

```java
private Node addConditionWaiter() {
    Node t = lastWaiter;
    // If lastWaiter is cancelled, clean out.
    if (t != null && t.waitStatus != Node.CONDITION) {
        unlinkCancelledWaiters();
        t = lastWaiter;
    }
    // 将当前线程包装成Node节点
    Node node = new Node(Thread.currentThread(), Node.CONDITION);
    // 如果等待队列为空，则将当前node节点赋值给firstWaiter，否则将当前节点指向 t.nextWaiter
    if (t == null)
        firstWaiter = node;
    else
        t.nextWaiter = node;
    // 当当前节点更新为lastWaiter
    lastWaiter = node;
    return node;
}
```

上面的代码逻辑比较简单，首先清理掉了等待队列中已经关闭的节点，然后将当前线程构建成一个waiteState为Node.CONDITION的Node节点。然后判断等待队列中是否为空，如果等待队列为空，则将当前构造的Node节点指向firstWaiter，如果等待队列不为空，则将当前构造的Node节点指向lastWaiter.nextWaiter，最后更新lastWaiter为当前构造的Node节点。弄清楚了将当前线程添加到等待队列中去后，我们在来看看当前线程是如何释放锁的。

###### 锁释放的过程

从 `await()` 方法的源码中我们看到线程线程释放锁通过调用`fullyRelease(node)`方法来处理的，该方法源码如下：

```java
final int fullyRelease(Node node) {
    boolean failed = true;
    try {
        // 获取当前同步状态
        int savedState = getState();
        // 如果释放同步状态成功，则返回之前保存的同步状态的值
        // （以独占模式释放同步状态）
        if (release(savedState)) {
            failed = false;
            return savedState;
        } else {
            // 如果释放失败，则抛出异常
            throw new IllegalMonitorStateException();
        }
    } finally {
        if (failed)
            // 若果抛出异常，则将当前节点的等待状态的值更新为Node.CANCELLED
            node.waitStatus = Node.CANCELLED;
    }
}
```

从上面代码中我们开的释放锁的主要实现是调用`release(savedState)`方法，而`release(savedState)`方法在前面AQS系列文章中已将讲到过，这里就不在赘述。我们知道release方法在释放同步状态后会唤醒同步队列中的后续节点来获取锁进行处理。

###### 怎样才能从await()方法中退出

从`await()`方法中我们看到，退出await()方法的条件定义如下：

```java
while (!isOnSyncQueue(node)) {
        // 挂起当前线程，调用次方法后线程会阻塞在这个地方，直到被唤醒或者中断
        LockSupport.park(this);
        // 当线程被唤醒后，判断线程是否已经被中断，若果中断则直接跳转while循环，否则进入再次进入while判断
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
    }
```

从上面代码可以看出，退出await()方法的条件要么是执行到break,要么是while条件为false。第一种情况的条件是当前线程被中断后代码会走break退出，第二种情况是当前节点被移动到同步队列中去了（即另外的线程调用了Condition中的signal()方法或signalAll()方法）。

#### 通知

当线程调用Condition中的signal()方法时，将会唤醒等待队列中的等待时间最长的节点（即等待队列中的第一个节点），在唤醒之前，会将节点移到同步队列中去。signal()方法定义如下：

```java
public final void signal() {
    //检查当前线程是否获取了锁
    if (!isHeldExclusively())
        throw new IllegalMonitorStateException();
    Node first = firstWaiter;
    if (first != null)
        doSignal(first);
}
```

从上面代码中我们可以看到，调用该方法的前置条件是当前线程必须获取了锁。signal()方法实际调用的是doSignal()方法，其源码如下：

```java
private void doSignal(Node first) {
    do {
        if ((firstWaiter = first.nextWaiter) == null)
            lastWaiter = null;
        first.nextWaiter = null;
    } while (!transferForSignal(first) &&
        (first = firstWaiter) != null);
}

/**
 * 将节点从条件队列传输到同步队列。
 * 如果成功则返回true
 */
final boolean transferForSignal(Node node) {
    /*
     * 如果无法更改waitStatus，则该节点已被取消
     */
    if (!compareAndSetWaitStatus(node, Node.CONDITION, 0))
        return false;

    //将节点添加到同步队列尾部,并返回当前节点的前驱节点
    Node p = enq(node);
    //获取前驱节点的等待状态
    int ws = p.waitStatus;
    //如果该结点的状态为cancel 或者修改waitStatus失败，则直接唤醒。
    if (ws > 0 || !compareAndSetWaitStatus(p, ws, Node.SIGNAL))
        LockSupport.unpark(node.thread);
    return true;
}
```

可以看到，正常情况 ws > 0 || !compareAndSetWaitStatus(p, ws, Node.SIGNAL) 这个判断是不会为true的，所以，不会在这个时候唤醒该线程。只有到发送signal信号的线程调用reentrantLock.unlock()后因为它已经被加到AQS的等待队列中，所以才会被唤醒。被唤醒后的线程，将从await()方法中的while循环中退出（isOnSyncQueue(Node node)方法返回true，节点已经在同步队列中），进而调用同步器的acquireQueued()方法加入到获取同步状态的竞争中。成功获取同步状态（或者说锁）之后，被唤醒的线程将从先前调用的await()方法返回，此时该线程已经成功地获取了锁。Condition的signalAll()方法，相当于对等待队列中的每个节点均执行一次signal()方法，效果就是将等待队列中所有节点全部移动到同步队列中，并唤醒每个节点的线程。 

#### 总结

最后我们来总结下await()方法和signal()方法的流程，其流程图如下：

![await方法和signal方法的流程](http://cdn.zzwzdx.cn/blog/await方法和signal方法的流程.png&blog)

