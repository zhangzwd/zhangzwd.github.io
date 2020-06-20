---
title: AQS之简介
tags:
  - Java
  - 线程
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: introduction-of-aqs
show_title: introduction-to-aqs
original: true
date: 2019-07-17 13:14:23
---

队列同步器AbstractQueuedSynchronizer（以下简称AQS）是用来构建锁或者其他同步组件的基础框架，它使用了一个int成员变量state来表示同步状态，通过内置一个FIFO队列来完成资源获取线程的排队工作。并发包的作者（Doug Lea）期望它能够实现大部分同步需求的基础。它是JUC并发包中的核心基础组件。

同步器AbstractQueuedSynchronizer是一个抽象类，因此同步器的主要使用方式是继承。子类通过继承同步器并实现它的抽象方法来管理同步状态。在抽象方法的实现过程中，免不了对同步器的状态进行更新，因此同步器中提供了3个设置和修改同步状态的方法，它们分别是：

1. `getState()：` 获取当前同步器的状态。
2. `setState(int newState)：` 设置当前同步器的状态
3. `compareAndSetState(int expect, int update)：` 原子性的更新当前同步器的状态。如果当前同步器的状态值和期望值（expect）相等，则将同步器的状态值更新为update的值，否则不更新当前同步器状态值。

子类推荐被定义为自定义同步器的静态内部类，同步器自身没有实现任何同步接口，它仅仅是定义了若干同步状态的获取和释放的方法来供自定义同步组件的使用。同步器即可以支持独占模式获取同步器状态，也支持共享模式获取同步器状态，这样就可以实现不同类型的同步器组件。例如ReentrantLock、ReentrantReadWriteLock、Semaphore和CountDownLatch等等。同步器隐藏了大量的实现细节，简化了锁的实现方法，屏蔽了同步状态的管理，线程的排队、等待与唤醒等底层操作。

同步器主要提供了以下方法：

* `getState()`：获取当前同步器状态
* `setState(int newState)`：设置当前同步器状态
* `compareAndSetState(int expect, int update)`：使用CAS设置当前同步器状态，该方法能够保证设置状态的原子性。
* `tryAcquire(int arg)`：独占式获取同步状态，实现该方法需要查询当前同步器状态并判断同步器状态是否符合预期值，然后在进行CAS设置同步状态。
* `tryRelease(int arg)`：独占式释放同步状态，等待获取同步状态的线程将有机会获取同步状态。
* `tryAcquireShared(int arg)`：共享式获取同步状态，返回的值大于等于0，则表示获取成功，反之获取失败。
* `tryReleaseShared(int arg)`：共享式释放同步状态。
* `isHeldExclusively()`：同步器是否在独占模式下被线程占用，一般该方法表示是否被当前线程独占。
* `acquire(int arg)`：独占模式获取同步状态，忽略中断。如果当前线程获取同步状态成功，则由该方法返回，否则将进入同步队列等待，该方法将会调用重写的的tryAcquire(int arg)方法。
* `acquireInterruptibly(int arg)`：独占式获取同步状态，但是该方法响应中断。当前线程未获取到同步状态则进入同步队列中，如果当前线程被中断，则该方法会抛出InterruptedException并返回。
* `tryAcquireNanos(int arg, long nanosTimeout)`：超时获取同步状态，如果当前线程在超时时间nanos内没有获取到同步状态，则返回false，反之返回true.
* `acquireShared(int arg)`：共享式获取同步状态，忽略响应中断。如果当前线程未获取到同步状态，将会进入同步队列中等待，与独占模式获取同步状态的主要区别在于同一时刻可以有多个线程获取到同步状态。
* `acquireSharedInterruptibly(int arg)`：与acquireShared(int arg)相同，区别在于该方法响应中断。
* `tryAcquireSharedNanos(int arg, long nanosTimeout)`：共享获取同步状态，增加超时限制。
* `release(int arg)`：独占式的释放同步状态，该方法会在释放同步状态之后将同步队列中第一个节点包含的线程唤醒。
* `releaseShared(int arg)`：共享式的释放同步状态。

同步器提供的模板方法基本上分为3类：**独占式**获取与释放同步状态、**共享式**获取与释放状态以及查询同步队列中等待线程的情况。

只有掌握了同步器的工作原理才能更深入的理解JUC（并发包）中的其它组件，下一章LZ将用一个简单的例子来了解下同步器的工作原理。
