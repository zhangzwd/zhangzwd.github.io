---
title: JUC并发容器之ConcurrentLinkedQueue源码分析
tags:
  - Java
  - 线程
  - ConcurrentLinkedQueue
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: source-code-analysis-of-concurrentlinkedqueue-of-juc-concurrent-container
original: true
show_title: juc-concurrent-linkedqueue
date: 2019-09-27 13:54:40
---
在并发编程中，我们有时需要使用到线程安全的队列，而线程安全队列的实现一般有两种方式：一种是使用阻塞算法，一种是使用非阻塞算法。使用阻塞算法的队列可以使用一把锁(入列和出列使用同一把锁)或两把锁(入列和出列使用不同的锁)来实现的。非阻塞算法方式则是利用循环CAS来实现的。这一章我们就来探索一下非阻塞算法实现的线程安全队列ConcurrentLinkedQueue。

ConcurrentLinkedQueue规定了如下几个不变性：

1. 如果队列中存在元素，那么最后一个元素的next为null
2. 队列中所有未删除的节点的item都不能为null且都能从head节点遍历到
3. 对于要删除的节点，不是直接将其设置为null，而是先将其item域设置为null（迭代器会跳过item为null的节点）
4. 允许head和tail更新滞后。即head、tail不总是指向第一个元素和最后一个元素。

### ConcurrentLinkedQueue的结构

通过ConcurrentLinkedQueue的类图我们来分析下它的结构，类图如下：

![](http://cdn.zzwzdx.cn/blog/concurrentLinkedQueue类图.png&blog)

由上面ConcurrentLinkedQueue的类图，我们可以看出ConcurrentLinkedQueue是由head和tail节点组成，每个节点（Node）又有元素item和指向下一个节点的引用next组成，节点与节点之间就是通过next进行关联的。默认情况下head和tail相等并且都等于空。我们先来看看ConcurrentLinkedQueue的重要组成部分节点的源码定义。

### Node定义

Node源码定义如下：

```java
private static class Node<E> {
    //内容
    volatile E item;
    //指向下一个节点的引用
    volatile Node<E> next;

    //构造函数
    Node(E item) {
        UNSAFE.putObject(this, itemOffset, item);
    }
	//CAS方式更新item的值
    boolean casItem(E cmp, E val) {
        return UNSAFE.compareAndSwapObject(this, itemOffset, cmp, val);
    }
	
    void lazySetNext(Node<E> val) {
        UNSAFE.putOrderedObject(this, nextOffset, val);
    }
    //CAS方式更新next的值
    boolean casNext(Node<E> cmp, Node<E> val) {
        return UNSAFE.compareAndSwapObject(this, nextOffset, cmp, val);
    }

    // Unsafe mechanics

    private static final sun.misc.Unsafe UNSAFE;
    //当前结点的偏移量
    private static final long itemOffset;
    //下一个结点的偏移量
    private static final long nextOffset;

    static {
        try {
            UNSAFE = sun.misc.Unsafe.getUnsafe();
            Class<?> k = Node.class;
            itemOffset = UNSAFE.objectFieldOffset
                (k.getDeclaredField("item"));
            nextOffset = UNSAFE.objectFieldOffset
                (k.getDeclaredField("next"));
        } catch (Exception e) {
            throw new Error(e);
        }
    }
}
```

Node的定义比较简单，接下来我们分析ConcurrentLinkedQueue源码

### ConcurrentLinkedQueue初始化

ConcurrentLinkedQueue定义了两个构造函数，默认的构造函数是构建一个初始为空的ConcurrentLinkedQueue。构造函数定义如下：

```java
//初始一个为空的ConcurrentLinkedQueue,此时head和tail都指向一个item为空的节点
public ConcurrentLinkedQueue() {
    head = tail = new Node<E>(null);
}
//传入一个集合来初始化ConcurrentLinkedQueue
public ConcurrentLinkedQueue(Collection<? extends E> c) {
    Node<E> h = null, t = null;
    //遍历传入的结合c
    for (E e : c) {
        //集合中的每个元素不能为空
        checkNotNull(e);
        Node<E> newNode = new Node<E>(e);
        if (h == null)
            h = t = newNode;
        else {
            //将t的next值设置为newNode
            t.lazySetNext(newNode);
            t = newNode;
        }
    }
    if (h == null)
        h = t = new Node<E>(null);
    head = h;
    tail = t;
}
```

看完了ConcurrentLinkedQueue的初始化，接下来我们分析ConcurrentLinkedQueue的入队与出队操作。

### ConcurrentLinkedQueue入队操作

对于熟悉链表结构的同学来说，入列是一个很简单的事情，即找到队列的尾节点，然后将尾节点的next赋值为新的节点，然后更新尾节点为新的节点即可。对于单线程，这样操作完全没有问题，但是对于多线程呢？如果一个线程要执行入列操作，那么它必须先找到尾节点，然后更新尾节点的next值，但是在更新next的值之前，如果有另一个线程此时正好已经更新尾节点，那么数据是不是会出现丢失的情况？对于多线程下的情况，我们来看看ConcurrentLinkedQueue是如何解决的。我们先看入列操作的offer(E e) 方法，该方法是将指定元素插入到队列尾部，其源码如下：

```java
public boolean offer(E e) {
	//检查要插入的节点是否为空，为空则直接抛出NullPointerException异常
    checkNotNull(e);
    //构建新的节点
    final Node<E> newNode = new Node<E>(e);
    /**
    * 死循环，直到新的节点插入为止
    * 1、根据tail节点定位出尾节点（last node）
    * 2、将新节点置为尾节点的下一个节点
    * 3、cas Tail更新尾节点
    */
    for (Node<E> t = tail, p = t;;) {
        // p用来表示队列的尾节点，初始情况下等于tail节点
        // q是p的next节点
        Node<E> q = p.next;
        //q == null 表示 p已经是最后一个节点了，尝试加入到队列尾
        //如果插入失败，则表示其他线程已经修改了p的指向
        if (q == null) {
            // casNext：t节点的next指向当前节点
            // casTail：设置tail 尾节点
            // 设置p节点的下一个节点为新节点，设置成功则casNext返回true；否则返回false，说明有其他线程更新过尾节点
            if (p.casNext(null, newNode)) {
                // 如果p != t，则将入队节点设置成tail节点，更新失败了也没关系，因为失败了表示有其他线程成功更新了tail节点
                //这里p!=t是因为tail并不是每次都指向最后一个节点
                if (p != t) // hop two nodes at a time
                    casTail(t, newNode);  // Failure is OK.
                return true;
            }
        }
        // p == q 等于自身
        else if (p == q)
            // p == q 代表着该节点已经被删除了
            // 由于多线程的原因，我们offer()的时候也会poll()，如果offer()的时候正好该节点已经poll()了
            // 那么在poll()方法中的updateHead()方法会将head指向当前的q，而把p.next指向自己，即：p.next == p
            // 这样就会导致tail节点滞后head（tail位于head的前面），则需要重新设置p
            p = (t != (t = tail)) ? t : head;
        // tail并没有指向尾节点
        else
            // tail已经不是最后一个节点，将p指向最后一个节点
            p = (p != t && t != (t = tail)) ? t : q;
    }
}
```

从源码角度来看，整个入队过程主要做了两件事：

1. 定位出尾节点
2. 使用CAS算法将新入队节点设置成尾节点的next节点，如不成功则重试

第一步定位出尾节点，tail节点并不一定是尾节点，所有每次入列都必须通过tail来找到尾节点。尾节点有可能就是tail节点，也有可能是tail节点的next。循环体中的第一个条件判断就是判断tail节点的next是否为空，如果为空，则表示tail节点就是尾节点，否则表示tail的next节点才是尾节点。

第二步设置入队节点为尾节点。p.casNext(null, newNode)方法用于将入队节点设置为当前队列尾节点的next节点，q如果是null表示p是当前队列的尾节点，如果不为null表示有其他线程更新了尾节点，则需要重新获取当前队列的尾节点。

### tail节点不一定为尾节点的设计意图

看到这里，我们可以会疑惑，tail为什么不总是最后一个节点，Doug  Lea大神这样设计的好处又是什么？接下来我们先探讨下tail节点不一定为尾节点的设计用意。

如果我们将tail永远的指向尾节点，那么在入列的时候，每次必定要执行`casTail(t, newNode)`这条语句，这就增加了一次volatile变量写操作的开销，而我们知道volatile变量的写操作的开销远大于volatile变量读操作的开销，因此Doug Lea大神的设计是通过增加volatile变量的读操作来减少volatile变量的写操作，这样入队的效率会有所提升。我们不得不佩服Doug Lea 大神的天才设计。

ConcurrentLinkedQueue的入队操作整体逻辑如下图所示：

![](http://cdn.zzwzdx.cn/blog/入列过程.png&blog)

### ConcurrentLinkedQueue出队操作

出队列就是从队列中返回一个节点元素，并清空这个节点元素的引用。首先我们还是来看看出队列的定义：

```java
public E poll() {
    restartFromHead:
    for (;;) {
        //从head节点开始遍历
        for (Node<E> h = head, p = h, q;;) {
            // 获取p节点的元素
            E item = p.item;
		    // 如果p节点的元素为空且CAS更新item成功
            if (item != null && p.casItem(item, null)) {                             // 条件①
                // p和h不相等，则更新头结点，否则直接返回
                if (p != h) // hop two nodes at a time                               // 条件②  
                    updateHead(h, ((q = p.next) != null) ? q : p);
                return item;
            }
		    // 如果头节点的元素为空或头节点发生了变化，这说明头节点已经被另外一个线程修改了。
            // 那么获取p节点的下一个节点，如果p节点的下一节点为null，则表明队列已经空了
            else if ((q = p.next) == null) {                                         //条件③
                //更新头结点，预期值h=head,更新p.此时p的item是空，说明已经被出队了
                updateHead(h, p);
                return null;
            }
            // p == q，则使用新的head重新开始
            else if (p == q)                                                         //条件④
                continue restartFromHead;
            else
                p = q;
        }
    }
}
```

上面方法主要逻辑就是首先取出队列的头结点，然后判断头结点元素是否为空，如果为空，则表示有另一个线程已经进行了一次出队操作将该节点取走，如果不为空，则使用CAS方法将头结点的item设置成空，如果CAS设置成功，判断p和q是否相等，如果不相等则更新头结点，否则直接返回。如CAS设置失败，则表示出现了并发，需要重新从头结点遍历。下面我们还是来模拟出队列的操作。首先假设队列初始如下：

![](http://cdn.zzwzdx.cn/blog/出队列_0.png&blog)

**poll 节点A：**

此时p=h=head,而head此时执行的是一个空节点即p.item=null,因此条件①不成立，跳到条件③（(q = p.next) == null），条件③也不成立，最后把执行p = q，然后再次循环。此时各个变量如下图所示：

![](http://cdn.zzwzdx.cn/blog/出队列_1.png&blog)

此时p指向节点A，因此p.item ！=null ，进行p.casItem(item, null)，如果这个CAS成功，发现p!=h,因此执行updateHead(h, ((q = p.next) != null) ? q : p)，q=p.next此时指向节点B,不为空，则将head CAS更新成节点B，如下所示：

![](http://cdn.zzwzdx.cn/blog/出队列_2.png&blog)

**poll节点B：**

此时h=head,p=h,因此item = p.item = B,条件①成功，发现条件p=h，因此直接return，结果如下图：

![](http://cdn.zzwzdx.cn/blog/出队列_3.png&blog)

**poll节点C：**

此时h = head, p = h，item = p.item=null,因此条件①不成立，跳到条件③（(q = p.next) == null，此时p.next=节点C！=null）,条件③不成立，跳到条件④，发现条件④也不成立，因此直接运行p = q;然后再次运行。此时各个变量如下所示：

![](http://cdn.zzwzdx.cn/blog/出队列_4.png&blog)

此时条件①成立，条件②也成立，因此执行updateHead(h, ((q = p.next) != null) ? q : p);执行后如下图所示：

![](http://cdn.zzwzdx.cn/blog/出队列_5.png&blog)

看完上面poll的流程，我们在回去看offer操作中的这段操作，我们就能明白了：

```java
else if (p == q)
    // p == q 代表着该节点已经被删除了
    // 由于多线程的原因，我们offer()的时候也会poll()，如果offer()的时候正好该节点已经poll()了
    // 那么在poll()方法中的updateHead()方法会将head指向当前的q，而把p.next指向自己，即：p.next == p
    // 这样就会导致tail节点滞后head（tail位于head的前面），则需要重新设置p
    p = (t != (t = tail)) ? t : head;
```

此时我们发现，p==q即表示该节点已经被删除了，而poll()方法中的updateHead()方法会更新head的指向，因此tail会滞后head,如上图所示。如果该节点是被删除了，则判断下tail是否有改动，如果有，则p指向新的tail,如果没有，则把p指向head。

如果此时，我们再向队列中添加节点D，此时p=q,更新p节点为head节点，重新循环，此时q=p.next为null,直接添加元素到p.next中，并更新tail节点。如下图所示：

![](http://cdn.zzwzdx.cn/blog/入列_6.png&blog)

### 总结

ConcurrentLinkedQueue 的非阻塞算法实现可概括为下面 5 点：

* 使用 CAS 原子指令来处理对数据的并发访问，这是非阻塞算法得以实现的基础。
* head/tail 并非总是指向队列的头 / 尾节点，也就是说允许队列处于不一致状态。 这个特性把入队 / 出队时，原本需要一起原子化执行的两个步骤分离开来，从而缩小了入队 / 出队时需要原子化更新值的范围到唯一变量。这是非阻塞算法得以实现的关键。
* 由于队列有时会处于不一致状态。为此，ConcurrentLinkedQueue 使用三个不变式来维护非阻塞算法的正确性。
* 以批处理方式来更新 head/tail，从整体上减少入队 / 出队操作的开销。
* 为了有利于垃圾收集，队列使用特有的 head 更新机制；为了确保从已删除节点向后遍历，可到达所有的非删除节点，队列使用了特有的向后推进策略。
