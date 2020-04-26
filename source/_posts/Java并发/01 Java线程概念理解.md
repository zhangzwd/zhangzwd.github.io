---
title: Java线程概念理解
tags:
  - Java
  - 线程
copyright: true
categories:
  - Java并发编程
translate_title: understanding-the-concept-of-java-thread
show_title: java-thread
special: JUC
original: true
date: 2019-05-09 14:06:08
---

##### 1 进程
> 进程是现代操作系统资源调度和分配的基本单位。在现代操作系统中一个程序就是一个进程。每个进程都拥有一块独立的运行空间。例如在window系统中一个运行的exe程序就是一个进程。

 ##### 2 线程
> 线程是现代操作系统调度的最小单元，一个进程可以创建多个线程。一个线程拥有自己独立的堆栈、程序计数器和局部变量，线程共享进程的内存。

线程在Java程序中无时不在，就算只运行一个简单的java程序也有线程在运行，例如下面一段代码：

``` java
public class Test {       
    public static void main(String[] args) {        
        ThreadMXBean threadMXBean =  ManagementFactory.getThreadMXBean();   
        ThreadInfo[] threadInfos =  threadMXBean.dumpAllThreads(false,false);  
        for (ThreadInfo threadInfo:threadInfos){            
            System.out.println("[" + threadInfo.getThreadId() +                         
                    "] "+threadInfo.getThreadName());       
        }   
     }
 }
output：
[6] Monitor Ctrl-Break
[5] Attach Listener
[4] Signal Dispatcher
[3] Finalizer
[2] Reference Handler
[1] main
```
从上面输出我们可以看出，Java程序的入口main()方法实际上是由一个叫做“main”的线程在调用执行。

#### 3 Java中的线程

    Java中线程创建的几种方式：

*     继承Thread类创建线程
*     实现Runnable接口创建线程
*     实现Callable接口通过FutureTask包装器来实现

第一种和第二种是常用的无返回结果的线程实现方式，第三种则相对少见的有结果返回的线程实现方式。以上3种创建线程的方式可以分为2类，一类是继承Thread，另一类是实现接口。下面是3种创建线程和调用的案例：

> 1、继承Thread
```java
public class ThreadOne extends Thread {

    @Override
    public void run() {
        System.out.println("线程开始执行...");
    }

    public static void main(String[] args) {
        ThreadOne t = new ThreadOne();
        t.start();
    }
}
```
> 2、实现Runnable接口
```java
public class ThreadTwo implements Runnable {
    @Override
    public void run() {
        System.out.println("线程开始执行...");
    }

    public static void main(String[] args) {
        ThreadTwo t = new ThreadTwo();
        Thread tt = new Thread(t);
        tt.start();
    }
}
```
> 3、实现Callable接口
```java
public class ThreadThree implements Callable < Integer > {
    @Override
    public Integer call() throws Exception {
        return 123;
    }


    public static void main(String[] args) throws ExecutionException,
    InterruptedException {
        ThreadThree t = new ThreadThree();
        FutureTask < Integer > ft = new FutureTask < > (t);
        Thread tt = new Thread(ft);
        tt.start();
        int result = ft.get();
        System.out.println(result);
    }
}
```
