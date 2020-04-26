---
title: JUC阻塞队列之LinkedTransferQueue源码分析
tags:
  - Java
  - 线程
  - LinkedTransferQueue
copyright: true
categories:
  - Java并发编程
special: JUC
original: true
show_title: juc-linkedTransferQueue
translate_title: source-code-analysis-of-linkedtransferqueue-of-juc-blocking-queue
date: 2019-11-18 14:48:40
---

LinkedTransferQueue从名称上我们就能判断出它是基于链表结构的，它是一个先进先出（FIFO）的阻塞无界队列。LinkedTransferQueue同样继承了AbstractQueue，并且实现了`TransferQueue`接口。LinkedTransferQueue 与普通的阻塞队列的区别是，当有消费者等待消费数据时，生产者可以将生产的数据直接交给消费者而不用进入队列中。下面我们就来看看LinkedTransferQueue 是如何实现的。

### 构造函数和节点实现

LinkedTransferQueue的构造函数有2中，分别如下：

```java
/**
* 初始化一个空的队列
*/
public LinkedTransferQueue() {
}

/**
*通过制定集合C来构建队列
*/
public LinkedTransferQueue(Collection<? extends E> c) {
    this();
    addAll(c);
}
```

其中`addAll(c)`是`AbstractQueue`中提供的方法，其源码如下：

```java
public boolean addAll(Collection<? extends E> c) {
    //检查判断参数是否为空
    if (c == null)
        throw new NullPointerException();
    //检查判断参数是否为自身
    if (c == this)
        throw new IllegalArgumentException();
    boolean modified = false;
    //遍历集合并调用add方法添加元素
    for (E e : c)
        if (add(e))
            modified = true;
    return modified;
}
public boolean add(E e) {
    //调用LinkedTransferQueue实现的offer方法
    if (offer(e))
        return true;
    else
        throw new IllegalStateException("Queue full");
}
```

从上面源码中我们可以看到，通过给定制定的集合来初始化LinkedTransferQueue最终的核心是调用LinkedTransferQueue的`offer`方法。此方法我们后面再详细说明。

既然LinkedTransferQueue是基于链表来实现了，那我们就先来看看其 阻塞队列的节点Node是如何设计如的，其源码如下：

```java
static final class Node {
    //如为true,说明是一个数据节点，否则为一个请求节点
    final boolean isData;
    //数据域 
    volatile Object item; 
    //下一个指向的节点
    volatile Node next;
    //当请求节点线程进入等待前，赋予该节点值
    volatile Thread waiter;

    // CAS设置next的值
    final boolean casNext(Node cmp, Node val) {
        return UNSAFE.compareAndSwapObject(this, nextOffset, cmp, val);
    }

    //CAS设置item的值
    final boolean casItem(Object cmp, Object val) {
        // assert cmp == null || cmp.getClass() != Node.class;
        return UNSAFE.compareAndSwapObject(this, itemOffset, cmp, val);
    }

    /**
     * 构造Node节点
     */
    Node(Object item, boolean isData) {
        UNSAFE.putObject(this, itemOffset, item); // relaxed write
        this.isData = isData;
    }

    /**
     * 将next指向自身，表明节点被删除
     */
    final void forgetNext() {
        UNSAFE.putObject(this, nextOffset, this);
    }

    /**
     * 设置item的值为自身
     * 设置waiter的值为空
     * 在节点被匹配过或者清除时调用
     */
    final void forgetContents() {
        UNSAFE.putObject(this, itemOffset, this);
        UNSAFE.putObject(this, waiterOffset, null);
    }

    /**
     * 检查节点是否被匹配过了
     */
    final boolean isMatched() {
        Object x = item;
        return (x == this) || ((x == null) == isData);
    }

    /**
     * 是否是一个未匹配的请求节点
     * 如果是的话isData应为false，item == null，因位如果匹配了，item则会有值
     */
    final boolean isUnmatchedRequest() {
        return !isData && item == null;
    }

    /**
     * 如果给定的节点不能挂在当前节点后返回true
     */
    final boolean cannotPrecede(boolean haveData) {
        boolean d = isData;
        Object x;
        return d != haveData && (x = item) != this && (x != null) == d;
    }

    /**
     * 尝试匹配一个数据节点
     */
    final boolean tryMatchData() {
        // assert isData;
        Object x = item;
        if (x != null && x != this && casItem(x, null)) {
            LockSupport.unpark(waiter);
            return true;
        }
        return false;
    }

    private static final long serialVersionUID = -3375979862319811754 L;

    // Unsafe mechanics
    private static final sun.misc.Unsafe UNSAFE;
    private static final long itemOffset;
    private static final long nextOffset;
    private static final long waiterOffset;
    static {
        try {
            UNSAFE = sun.misc.Unsafe.getUnsafe();
            Class < ? > k = Node.class;
            itemOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("item"));
            nextOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("next"));
            waiterOffset = UNSAFE.objectFieldOffset(k.getDeclaredField("waiter"));
        } catch (Exception e) {
            throw new Error(e);
        }
    }
}
```

关于Node结点，有以下几点需要特别注意：

1. Node结点有两种类型：数据结点、请求结点，通过字段`isData`区分，只有不同类型的结点才能相互匹配；
2. Node结点的值保存在`item`字段，匹配前后值会发生变化；

### put操作

LinkedTransferQueue的put操作提供了put、offer和add方法。它们的目的都是向队列中添加一个元素，我们来看看他们的实现。

```java
/**
 * 向队列尾部添加一个元素
 * 因为队列是无界的，所以该方法永远不会阻塞
 */
public void put(E e) {
    xfer(e, true, ASYNC, 0);
}

/**
 * 向队列尾部添加一个元素
 * 因为队列是无界的，所以该方法永远不会返回false
 */
public boolean offer(E e) {
    xfer(e, true, ASYNC, 0);
    return true;
}


/**
 * 向队列尾部添加一个元素
 * 因为队列是无界的，所以该方法永远不会返回false
 */
public boolean offer(E e, long timeout, TimeUnit unit) {
    xfer(e, true, ASYNC, 0);
    return true;
}

/**
 * 向队列尾部添加一个元素
 *因为队列是无界的，所以该方法永远不会返回false
 */
public boolean add(E e) {
    xfer(e, true, ASYNC, 0);
    return true;
}
```

从上面源码中，我们可以发现，put操作的所有方法都是凋用`xfer`这个方法，并且传入的参数都是一样的。`xfer`方法在介绍完take操作后，我们在介绍。

### take操作

LinkedTransferQueue的take操作提供了take和poll两中方法，它们的定义如下：

```java
 public E take() throws InterruptedException {
     E e = xfer(null, false, SYNC, 0);
     if (e != null)
         return e;
     Thread.interrupted();
     throw new InterruptedException();
 }

 public E poll(long timeout, TimeUnit unit) throws InterruptedException {
     E e = xfer(null, false, TIMED, unit.toNanos(timeout));
     if (e != null || !Thread.interrupted())
         return e;
     throw new InterruptedException();
 }

 public E poll() {
     return xfer(null, false, NOW, 0);
 }
```

从LinkedTransferQueue的put操作和take操作我们可以总结出如下2点：

1.  这些函数读取/插入数据实际调用的都是xfer这一个函数来完成的。

2. 这些函数中传入了4个重要的常量，来区分每个方法的调用。这4个常量分别是NOW、ASYNC 、SYNC 和 TIMED ，它们的值分别为0、1、2、3。这4个常量代表意义如下：

    1. **NOW表示即时操作（可能失败），即不会阻塞调用线程：** 

         poll（获取并移除队首元素，如果队列为空，直接返回null）；tryTransfer（尝试将元素传递给消费者，如果没有等待的消费者，则立即返回false，也不会将元素入队） 

    2.  **ASYNC表示异步操作（必然成功）：** 

         offer（插入指定元素至队尾，由于是无界队列，所以会立即返回true）；put（插入指定元素至队尾，由于是无界队列，所以会立即返回）；add（插入指定元素至队尾，由于是无界队列，所以会立即返回true） 

    3.  **SYNC表示同步操作（阻塞调用线程）：** 

         transfer（阻塞直到出现一个消费者线程）；take（从队首移除一个元素，如果队列为空，则阻塞线程） 

    4.  **TIMED表示限时同步操作（限时阻塞调用线程）：** 

         poll(long timeout, TimeUnit unit)；tryTransfer(E e, long timeout, TimeUnit unit) 

 ### xfer函数

xfer作为LinkedTransferQueue里面最核心的函数, 在读取数据都依赖它, 接下来将看具体的实现。 

```java
/**
 *
 * @param e put操作的元素，当时take操作时e为null
 * @param haveData put操作为true，take操作为false
 * @param how NOW, ASYNC, SYNC, or TIMED
 * @param nanos 超时时间，仅TIMED模式有效
 * @return 
 * @throws NullPointerException if haveData mode but e is null
 */
private E xfer(E e, boolean haveData, int how, long nanos) {
    //检查数据合法性
    if (haveData && (e == null))
        throw new NullPointerException();
    //新建待插入的节点S
    Node s = null; 
    retry:
        // 死循环
        for (;;) { 
            //从头结点开始变量，知道匹配到节点
            for (Node h = head, p = h; p != null;) { 
                // 获取p结点的类型，true为put操作，false为take操作
                boolean isData = p.isData;
                // 获取p结点的值
                Object item = p.item;
                // p结点存在并且未被匹配
                // item != p 表示节点未被删除
                // (item != null) == isData 表示节点未被匹配
                if (item != p && (item != null) == isData) { 
                    //若果头结点和代匹配的节点类型一致，则直接返回不进行匹配操作
                    if (isData == haveData) 
                        break;
                     // 开始匹配操作
                     // CAS方式将p节点的item的值设置为e
                    if (p.casItem(item, e)) {
                        //对于for循环，启动条件只要匹配节点不是head节点就会尝试将head节点cas为本匹配节点的next节点或者本匹配节点当匹配节点没有next节点时
                        for (Node q = p; q != h;) {
                            Node n = q.next; // update by 2 unless singleton
                            if (head == h && casHead(h, n == null ? q : n)) {
                                //cas head节点成功，则将之前的节点的next指针指向节点自身。这意味着节点脱离了队伍。同时，这也可以帮助gc。因为指向自身后，节点的不可达状态判断会更容易些。
                                //当节点的next指针指向自身，意味着该节点已经脱离队伍，是一个无效节点。这个是一个判断的充分条件。
                                h.forgetNext();
                                break;
                            }
                             //cas 失败后则检查当前head指针距离下一个有效节点是否大于2.大于则再次循环，否则退出。头节点的松弛长度由这段代码决定。从代码上可以看出，松弛距离是2.
                            if ((h = head) == null ||
                                (q = h.next) == null || !q.isMatched())
                                break; // unless slack < 2
                        }
                        LockSupport.unpark(p.waiter);
                        return LinkedTransferQueue. < E > cast(item);
                    }
                }
                //如果没有找到匹配节点就尝试下一个节点。如果该节点已经脱离队列，则从头开始。
                Node n = p.next;
                p = (p != n) ? n : (h = head); // Use head if p offlist
            }
            //没有找到匹配节点的情况下，并且不是无阻塞提取的操作的话，就构建一个节点，将自身节点放入队尾
            if (how != NOW) { 
                if (s == null)
                    s = new Node(e, haveData);
                 //尝试将节点放入队尾。该方式是存在失败可能。此时需要重新开始完整流程。而s不需要初始化两次。保存作为临时变量即可。
                Node pred = tryAppend(s, haveData);
                if (pred == null)
                    continue retry; // lost race vs opposite mode
                if (how != ASYNC)
                    //只有SYNC或者TINED情况, 线程才会被阻塞。只有部分接口才会阻塞线程
                    return awaitMatch(s, pred, e, (how == TIMED), nanos);
            }
            return e; // not waiting
        }
}
```

xfer方法主要逻辑如下：

* 检查传入的参数e和haveData是否匹配
* 从队列的头结点开始向后遍历，查找到第一个未匹配的节点。
* 如果第一个未匹配的节点与本次请求模式一致，并且本次请求不是无阻塞的请求，则将本次请求加入到阻塞队列中(tryAppend)。
* 如果第一个未匹配的节点与本次请求模式不一致，则开始匹配：
    * 如果匹配成功，并且匹配的节点不是头结点，则重新定位头结点并将原来的头结点删除，然后唤醒匹配节点等待的线程并返回。
    * 如果匹配失败，则尝试匹配下一个节点。

下面我们来看看将节点添加到队列尾部的tryAppend方法，该方法定义如下：

```java
/**
 * 将节点添加到队列尾部
 *
 * @param s 待添加的节点
 * @param haveData 节点的模式
 * @return 如果添加失败则返回null,否则返回s的前驱节点，如果s没有前驱节点，则返回s本身
 */
private Node tryAppend(Node s, boolean haveData) {
    // 从队列尾部遍历
    for (Node t = tail, p = t;;) { 
        Node n, u; 
        //如果队列未初始化，则将s作为head节点，并返回自身
        if (p == null && (p = head) == null) {
            if (casHead(null, s))
                return s; 
        //如果队尾节点的模式和s节点的模式不一致，则返回true    
        } else if (p.cannotPrecede(haveData))
            return null;
        //若果p节点不是队尾节点，则重新定位队尾节点    
        else if ((n = p.next) != null) 
            p = p != t && t != (u = tail) ? (t = u) :
            (p != n) ? n : null; // restart if off list
        // CAS 将s节点添加到p节点后面，如果失败则将p.next 赋值给p    
        else if (!p.casNext(null, s))
            p = p.next; 
        else {
             //开始检查p与tail的松弛距离, 如果tail距离最终节点距离>2, 则tail继续向后移动。
            if (p != t) {
                while ((tail != t || !casTail(t, s)) &&
                    (t = tail) != null &&
                    (s = t.next) != null && // advance and retry
                    (s = s.next) != null && s != t);
            }
            return p;
        }
    }
}
```

tryAppend方法的目的就是将s节点添加到队列的尾部，若果成功则返回其前驱节点(没有前驱节点则返回自身)。如果失败则返回null。 在方法返回成功后，如果how还不是ASYNC则调用awaitMatch()方法阻塞等待： 

```java
private E awaitMatch(Node s, Node pred, E e, boolean timed, long nanos) {
    // 计算超时结束时间
    final long deadline = timed ? System.nanoTime() + nanos : 0 L;
    //当前线程
    Thread w = Thread.currentThread();
    int spins = -1; 
    ThreadLocalRandom randomYields = null; // bound if needed
    //开始死循环
    for (;;) {
        // 获取s节点的值
        Object item = s.item;
        // 节点已经被匹配
        if (item != e) { 
            // 撤销节点
            s.forgetContents(); 
            return LinkedTransferQueue. < E > cast(item);
        }
        // 线程中断或者超时了。则调用将s节点item设置为e，等待取消
        if ((w.isInterrupted() || (timed && nanos <= 0)) && s.casItem(e, s)) { 
            //断开节点
            unsplice(pred, s);
            return e;
        }
        // 自旋
        if (spins < 0) {
            // 计算自旋次数
            if ((spins = spinsFor(pred, s.isData)) > 0)
                randomYields = ThreadLocalRandom.current();
        } else if (spins > 0) { // spin
            --spins;
            //随机数==0，让出线程  没看明白
            if (randomYields.nextInt(CHAINED_SPINS) == 0)
                Thread.yield(); 
        // 将当前线程设置到节点的waiter域
        // 一开始s.waiter == null 肯定是会成立的，    
        } else if (s.waiter == null) {
            s.waiter = w; 
        //超时阻塞    
        } else if (timed) {
            nanos = deadline - System.nanoTime();
            if (nanos > 0 L)
                LockSupport.parkNanos(this, nanos);
        } else {
            LockSupport.park(this);
        }
    }
}
```

整个awaitMatch方法的逻辑大体不难理解，但是`Thread.yield(); `让出线程执行时间这个实在是没看明白。在awaitMatch执行过程中，如果线程被中断，或者超时则会调用`unsplice(pred, s);`将该节点移除。改方法定义如下：

```java
final void unsplice(Node pred, Node s) {
    //将item设置为自身节点，清空waiter数据。
    s.forgetContents(); 
    //if判断确认pred节点确实存在并且仍然是s的前置节点
    if (pred != null && pred != s && pred.next == s) {
        Node n = s.next;
        //一般情况下就只是将前置节点的next设置为本节点的后置节点。让遍历路径中去掉该取消节点即可。
        //而如果发现该取消节点是最后一个节点或者前置节点已经无效了，就需要做进一步的清理动作。
        if (n == null || (n != s && pred.casNext(s, n) && pred.isMatched())) {
            //首先是帮忙清理头结点，如果头节点已经失效的话
            for (;;) { 
                Node h = head;
                if (h == pred || h == s || h == null)
                    return; // at head or list empty
                if (!h.isMatched())
                    break;
                Node hn = h.next;
                if (hn == null)
                    return; // now empty
                if (hn != h && casHead(h, hn))
                    h.forgetNext(); // advance head
            }
            //如果前置节点和本身节点都在队列中，与上面的条件结合，此时这两个节点都是无效节点。此时就对sweepVotes（清除投票计数）原子增。如果一个线程发现其触发了阀值。则执行全队列清除动作。
            if (pred.next != pred && s.next != s) { // recheck if offlist
                for (;;) { // sweep now if enough votes
                    int v = sweepVotes;
                    if (v < SWEEP_THRESHOLD) {
                        if (casSweepVotes(v, v + 1))
                            break;
                    } else if (casSweepVotes(v, 0)) {
                        sweep();
                        break;
                    }
                }
            }
        }
    }
}
```

到这里主体流程已经结束。最后总结如下：

* LinkedTransferQueue的put操作和take操作都是通过调用`E xfer(E e, boolean haveData, int how, long nanos)`方法来完成的，只是操作中每个方法传入的how不同。
* 若果新节点的模式和队列中头结点的模式不一样，则直接进行匹配操作，新节点不加入到队列中。
* 如果新节点的模式和队列中头结点的模式一致，则将新节点添加到队列尾部。
* 若节点添加成功，且how != ASYNC， 则调用awaitMatch()方法阻塞等待， 在阻塞等待的过程中，若果线程超时或者被中断，则将节点从队列中移除。



