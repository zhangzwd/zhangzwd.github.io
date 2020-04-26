---
title: 深入分析synchronized实现原理
tags:
  - Java
  - 线程
  - synchronized
copyright: true
categories:
  - Java并发编程
translate_title: in-depth-analysis-of-synchronized-implementation-principle
show_title: synchronized-implementation-principle
special: JUC
original: true
date: 2019-05-21 18:03:42
---

#### <font color="#009688 ">实现原理</font>
> Synchronized可以保证一个在多线程运行中，同一时刻只有一个方法或者代码块被执行，它还可以保证共享变量的可见性和原子性

在Java中每个对象都可以作为锁，这是Synchronized实现同步的基础。具体的表现为一下3种形式：

1.  普通同步方法，锁是当前实例对象；
2.  静态同步方法，锁是当前类的Class对象；
3.  同步方法快，锁是Synchronized括号中配置的对象。

当一个线程试图访问同步代码块时，它必须先获取到锁，当同步代码块执行完毕或抛出异常时，必须释放锁。那么它是如何实现这一机制的呢？我们先来看一个简单的synchronized的代码：
```java
public class SyncDemo {

    public synchronized void play() {}

    public void learn() {
        synchronized(this) {

        }
    }
}
```
利用javap工具查看生成的class文件信息分析Synchronized，下面是部分信息
```java
public com.zzw.juc.sync.SyncDemo();
    descriptor: ()V
    flags: ACC_PUBLIC
    Code:
      stack=1, locals=1, args_size=1
         0: aload_0
         1: invokespecial #1                  // Method java/lang/Object."<init>":()V
         4: return
      LineNumberTable:
        line 8: 0
      LocalVariableTable:
        Start  Length  Slot  Name   Signature
            0       5     0  this   Lcom/zzw/juc/sync/SyncDemo;

  public synchronized void play();
    descriptor: ()V
    flags: ACC_PUBLIC, ACC_SYNCHRONIZED
    Code:
      stack=0, locals=1, args_size=1
         0: return
      LineNumberTable:
        line 10: 0
      LocalVariableTable:
        Start  Length  Slot  Name   Signature
            0       1     0  this   Lcom/zzw/juc/sync/SyncDemo;

  public void learn();
    descriptor: ()V
    flags: ACC_PUBLIC
    Code:
      stack=2, locals=3, args_size=1
         0: aload_0
         1: dup
         2: astore_1
         3: monitorenter
         4: aload_1
         5: monitorexit
         6: goto          14
         9: astore_2
        10: aload_1
        11: monitorexit
        12: aload_2
        13: athrow
        14: return
      Exception table:
         from    to  target type
             4     6     9   any
             9    12     9   any

```
从上面利用javap工具生成的信息我们可以看到同步方法是利用ACC_SYNCHRONIZED这个修饰符来实现的，同步代码块是利用monitorenter和monitorexit这2个指令来实现的。

* 同步代码块：monitorenter指令插入到同步代码块的开始位置，monitorexit指令插入到同步代码块的结束位置，JVM需要保证每一个monitorenter都有一个monitorexit与之相对应。任何对象都有一个monitor与之相关联，当且一个monitor被持有之后，他将处于锁定状态。线程执行到monitorenter指令时，将会尝试获取对象所对应的monitor所有权，即尝试获取对象的锁；
* 同步方法：synchronized方法则会被翻译成普通的方法调用和返回指令如:invokevirtual、areturn指令，在JVM字节码层面并没有任何特别的指令来实现被synchronized修饰的方法，而是在Class文件的方法表中将该方法的access_flags字段中的synchronized标志位置1，表示该方法是同步方法并使用调用该方法的对象或该方法所属的Class在JVM的内部对象表示Klass做为锁对象

在继续分析Synchronized之前，我们需要理解2个非常重要的概念：Java对象头和Monitor

#### <font color="009688 ">Java对象头</font>
Synchronized用的锁是存放在Java对象头里面的。那么什么是对象头呢？在Hotspot虚拟机中，对象头包含2个部分：标记字段（Mark Word)和类型指针（Kass point)。
其中Klass Point是是对象指向它的类元数据的指针，虚拟机通过这个指针来确定这个对象是哪个类的实例，Mark Word用于存储对象自身的运行时数据，它是实现轻量级锁和偏向锁的关键。这里我们将重点阐述Mark Word。

##### <font color="#009688">Mark Word</font>
Mark Word用于存储对象自身的运行时数据，如哈希码（Hash Code）、GC分代年龄、锁状态标志、线程持有锁、偏向线程ID、偏向时间戳等，这部分数据在32位和64位虚拟机中分别为32bit和64bit。一个对象头一般用2个机器码存储（在32位虚拟机中，一个机器码为4个字节即32bit）,但如果对象是数组类型，则虚拟机用3个机器码来存储对象头，因为JVM虚拟机可以通过Java对象的元数据信息确定Java对象的大小，但是无法从数组的元数据来确认数组的大小，所以用一块来记录数组长度。
在32位虚拟机中，Java对象头的Makr Word的默认存储结构如下：

| 锁状态   | 25bit          | 4bit         | 1bit 是否是偏向锁 | 2bit锁标志位 |
| -------- | -------------- | ------------ | ----------------- | :----------- |
| 无锁状态 | 对象的HashCode | 对象分代年龄 | 0                 | 01           |

在程序运行期间，对象头中锁表标志位会发生改变。Mark Word可能发生的变化如下：
![image](https://s2.ax1x.com/2019/05/06/EDX2UH.png)

在64位虚拟机中，Java对象头中Mark Work的长度是64位的,其结构如下：

![image](https://s2.ax1x.com/2019/05/06/EDXgVe.md.png)

介绍了Mark Word 下面我们来介绍下一个重要的概率Monitor。

#### <font color="#009688">Monitor</font>

Monitor是操作系统提出来的一种高级原语，但其具体的实现模式，不同的编程语言都有可能不一样。Monitor 有一个重要特点那就是，同一个时刻，只有一个线程能进入到Monitor定义的临界区中，这使得Monitor能够达到互斥的效果。但仅仅有互斥的作用是不够的，无法进入Monitor临界区的线程，它们应该被阻塞，并且在必要的时候会被唤醒。显然，monitor 作为一个同步工具，也应该提供这样的机制。Monitor的机制如下图所示：
![image](https://s2.ax1x.com/2019/05/06/EDXR5d.jpg)

从上图中，我们来分析下Monitor的机制：
Mointor可以看做是一个特殊的房间（这个房间就是我们在Java线程中定义的临界区），Monitor在同一时间，保证只能有一个线程进入到这个房间，进入房间即表示持有Monitor，退出房间即表示释放Monitor。
当一个线程需要访问临界区中的数据（即需要获取到对象的Monitro）时，他首先会在entry-set入口队列中排队等待（这里并不是真正的按照排队顺序），如果没有线程持有对象的Monitor,那么entry-set队列中的线程会和waite-set队列中被唤醒的线程进行竞争，选出一个线程来持有对象Monitor，执行受保护的代码段，执行完毕后释放Monitor，如果已经有线程持有对象的Monitor，那么需要等待其释放Monitor后再进行竞争。当一个线程拥有对象的Monitor后，这个时候如果调用了Object的wait方法，线程就释放了Monitor，进入wait-set队列，当Object的notify方法被执行后，wait-set中的线程就会被唤醒，然后在wait-set队列中被唤醒的线程和entry-set队列中的线程一起通过CPU调度来竞争对象的Monitor，最终只有一个线程能获取对象的Monitor。
>需要注意的是：
>当一个线程在wait-set中被唤醒后，并不一定会立刻获取Monitor，它需要和其他线程去竞争
>如果一个线程是从wait-set队列中唤醒后，获取到的Monitor，它会去读取它自己保存的PC计数器中的地址，从它调用wait方法的地方开始执行。

#### <font color="#009688">锁的优化和对比</font>
在JavaSE6为了对锁进行优化，引入了偏向锁和轻量级锁。在JavaSE6中锁一共有4种状态，它们从低到高一次是无状态锁、偏向锁、轻量级锁和重量级锁。锁的这几种状态会随着竞争而依次升级，但是锁是不能降级的。

##### <font color="#009688">偏向锁</font>
偏向锁顾名思义就是偏向于第一个访问锁的线程，在运行的过程中同步锁只有一个线程访问，不存在多线程竞争的情况，则线程不会触发同步，这种情况下会给线程加一个偏向锁。偏向锁的引入就是为了让线程获取锁的代价更低。

* ###### 偏向锁的获取

（1）访问Mark Word中偏向锁的标识是否设置成1，锁标志位是否为01——确认为可偏向状态。　　
（2）如果为可偏向状态，则测试线程ID是否指向当前线程，如果是，进入步骤（5），否则进入步骤（3）。　　
（3）如果线程ID并未指向当前线程，则通过CAS操作竞争锁。如果竞争成功，则将Mark Word中线程ID设置为当前线程ID，然后执行（5）；如果竞争失败，执行（4）。　　
（4）如果CAS获取偏向锁失败，则表示有竞争。当到达全局安全点（safepoint）时获得偏向锁的线程被挂起，偏向锁升级为轻量级锁，然后被阻塞在安全点的线程继续往下执行同步代码。　　
（5）执行同步代码。 

* ###### 偏向锁的释放
偏向锁的释放在上面偏向锁的获取中的第4步已经提到过。偏向锁只有在遇到其它线程竞争偏向锁时，持有偏向锁的线程才会释放。线程是不会主动的去释放偏向锁的。偏向锁的释放需要等到全局安全点（在这个时间点上没有正在执行的字节码），它会首先去暂停拥有偏向锁的线程，撤销偏向锁，设置对象头中的Mark Word为无锁状态或轻量级锁状态，再恢复暂停的线程。

* ###### 偏向锁的关闭
偏向锁在Java6和Java7中是默认开启的，但它是在应用程序启动几秒后才激活。如果想消除延时立即开启，可以调整JVM参数来关闭延迟：-XX: BiasedLockingStartupDelay=0。如果你确定应用程序中没有偏向锁的存在，你也可以通过JVM参数关闭偏向锁： -XX:UseBiasedLocking=false，使用改参数后，程序会默认进入到轻量级锁状态。

* ###### 偏向锁的适用场景
始终只有一个线程在执行同步块，在它没有执行完同步代码块释放锁之前，没有其它线程去执行同步块来竞争锁，在锁无竞争的情况下使用。一旦有了竞争就升级为轻量级锁，升级为轻量级锁的时候需要撤销偏向锁，撤销偏向锁需要在全局安全点上，这个时候会导致Stop The World，Stop The Wrold 会导致性能下降，因此在高并发的场景下应当禁用偏向锁。

##### <font color="#009688">轻量级锁</font>
轻量级锁是有偏向锁竞争升级而来的。引入轻量级锁的目的是在没有多线程竞争的情况下，减少传统的重量级锁使用操作系统互斥量产生的性能消耗。

* ###### 轻量级锁的获取
（1）在代码进入同步代码块时，如果同步对象没有被锁定（锁标志位为“01”状态），虚拟机首先将在当前线程的栈帧中建了一个名为锁记录（Lock Record）的空间，用于存储对象目前的Mark Word的拷贝，官方称之为 Displaced Mark Word。
（2）虚拟机将使用CAS操作尝试将对象的Mark Word更新为指向Lock Record的指针，如果更新成功，则表示获取到了锁，并将锁标志位设置为“00”（表示对象处于轻量级锁状态）。如果失败则执行（3）操作。
（3）虚拟机检查当前对象的Mark Wrod 是否指向当前线程的栈帧，如果是这说明当前线程已经持有了这个对象的锁，直接进入同步块继续运行；否则说明这个锁对象已经被其它线程持有，这是轻量级锁就要膨胀为重量级锁，锁标志的状态值变更为“10”，后面等待锁的线程也要进入阻塞状态。

* ###### 轻量级锁的释放
（1）使用CAS操作把对象当前的Mark Word和线程中复制的Displaced Mark Word替换回来，如果成功，则同步过程完成。
（2）CAS替换失败，说明有其他线程尝试过获取该锁，那就要在释放锁的同时，唤醒被挂起的线程。

轻量级锁能提升同步性能的依据是“对于绝大部分的锁，在整个同步周期都是不存在竞争的”。若果没有竞争，轻量级锁使用CAS操作避免了使用互斥量的开销，但如果存在锁竞争，除了互斥量的开销外，还额外发成了CAS操作，因此存在竞争的情况下，轻量级锁比传统的重量级做会更慢。

##### <font color="#009688">重量级锁</font>

重量级锁通过对象内部的监视器（monitor）实现，其中monitor的本质是依赖于底层操作系统的Mutex Lock实现，操作系统实现线程之间的切换需要从用户态到内核态的切换，切换成本非常高。

##### <font color="#009688">偏向锁、轻量级锁的状态转换</font>

![image](https://s2.ax1x.com/2019/05/07/ErBHo9.png)


#### <font color="#009688">其它优化</font>

* ##### 自旋锁
    线程的挂起和恢复需要CPU从用户状态切换到核心状态，频繁的挂起和恢复会给系统的并发性能带来很大的压力。同时我们发现在许多的应用上，共享该数据的锁定只会持续很短的一段时间，为了这一段很短的时间，让线程频繁的挂起和恢复是很不值得的，因此引入了自旋锁。
    自旋锁的原理非常的简单，若果那些持有锁的线程能够在很短的时间释放资源，那么那等待竞争锁的线程就不需要做用户状态和内核状态的切换进入阻塞挂起状态，它们只需要“稍等一下”，等待持有锁的线程释放资源后立即获取锁。这里需要注意的是，线程在自旋的过程中，是不会放弃CPU的执行时间的，因此如果锁被占用的时间很长，那么自旋的线程不做任何有用的工作从而浪费了CPU的资源。所有自旋等待时间必须有一个限制，如果自旋超过了限定的次数任然没有获取锁，则需要停止自旋进入阻塞状态。虚拟机设定的自旋次数默认是10次，可以通过 -XX：PreBlockSpin来更改。

* ##### 自适自旋锁
    上面说到自旋锁的自旋次数是一个固定的值，但是这个自旋次数应该如何限定了，设置大了会让线程一直占用CPU时间浪费性能，设置低了会让线程频繁的进入挂起和恢复状态也会浪费性能。因此JDK在1.6中引入了自适应自旋锁，自适应说明自旋的时间不在是固定的了，而是由前一次在同一个锁上的自旋时间以及锁的拥有者的状态来决定的。
    自适应自旋锁的原理也非常简单，当一个线程在一把锁上自旋成功，那么下一次在这个锁上自旋的时间将更长，因为虚拟机认为上次自旋成功了，那么这次自旋也有可能再次成功。反之，如果一个线程在一个锁上很少自旋成功，那么以后这个线程要获取这个锁时，自旋的此时将会减少甚至可能省略自旋的过程，直接进入阻塞状态以免浪费CPU的资源。
    
* ##### 锁消除
    锁消除是指虚拟机即时编译器在运行时，对一些代码上要求同步，但是被检测到不可能存在共享数据竞争的锁进行消除。锁消除的主要判定依据是逃逸分析的数据支持。变量是否逃逸对于虚拟机来说需要使用数据流来分析，但是对于我们程序员应该是很清楚的，怎么会在知道不存在数据竞争的情况下使用同步呢？但是程序有时并不是我们想的那样，虽然我们没有显示的使用锁，但是在使用一些Java 的API时，会存在隐式加锁的情况。例如如下代码：
```java
    
    public String concat(String s1, String s2){
        StringBuffer sb = new StringBuffer();
        sb.append(s1);
        sb.append(s2);
        return sb.toString();
    }
    
```
我们知道每个sb.append()方法中都有一个同步快，锁就是sb的对象。因此虚拟机在运行这段代码时，会监测到sb这个变量永远不会“逃逸”到concat()方法之外，因此虚拟机就会消除这段代码中的锁而直接执行了。


* ##### 锁粗化
    我们知道在使用同步锁的时候，需要尽量将同步块的作用范围限制的尽量小一些----只在共享数据的实际作用域中才进行同步，这样做的目的是为了是同步的时间尽可能的缩短，如果存在锁的竞争，那么等待锁的线程也能尽快的获取到锁。
    大多数情况下，上面的的原则都是正确的。但是如果一系列的连续操作都对同一个对象反复的加锁，甚至加锁出现在循环体中，那么即时没有竞争，频繁的进行互斥同步操作也会导致不必须的性能损耗。所以引入了锁粗化的概率。
    那么什么是锁粗化呢？锁粗化就是将连接加锁、解锁的过程连接在一起，扩展（粗化）成为一个同步范围更大的锁。以上面代码为例，就是扩展到第一个append()操作之前，直至最后一个append()操作之后，这样只需要加锁一次就可以了。


#### <font color="#009688">总结</font>
本文重点探究了Synchronized的实现原理，以及JDK引入偏向锁和轻量级锁对synchronized所做的优化处理，和一些其他的锁的优化处理。我们最后来总结一下Synchronized的执行过程： 
1. 检测Mark Word里面是不是当前线程的ID，如果是，表示当前线程处于偏向锁 。
2. 如果不是，则使用CAS将当前线程的ID替换Mard Word，如果成功则表示当前线程获得偏向锁，置偏向标志位1 。
3. 如果失败，则说明发生竞争，撤销偏向锁，进而升级为轻量级锁。 
4. 当前线程使用CAS将对象头的Mark Word替换为锁记录指针，如果成功，当前线程获得锁 。
5. 如果失败，表示其他线程竞争锁，当前线程便尝试使用自旋来获取锁。 
6. 如果自旋成功则依然处于轻量级状态。 
7. 如果自旋失败，则升级为重量级锁。
