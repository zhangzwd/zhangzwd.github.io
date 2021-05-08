---
title: AQS之工作原理
tags:
  - Java
  - 线程
  - 并发
copyright: true
categories:
  - Java并发编程
special: JUC
translate_title: how-aqs-works
show_title: how-aqs-works
original: true
date: 2019-08-27 21:12:33
---
### AQS之工作原理
前面一章LZ简单的介绍了下AbstractQueuedSynchronizer（AQS）以及AQS中提供的一些模板方法的功能和作用，这一章LZ将用一个简单的实例来介绍下AQS中独占锁的工作原理。独占锁顾名思义就是在同一时刻只能有一个线程能获取到锁，而其它需要获取这把锁的线程将进入到同步队列中等待获取到了锁的线程释放这把锁，只有获取锁的线程释放了锁，同步队列中的线程才能获取锁。LZ可能描述的有些绕，画图来解释下这段话的意思：

![AQS原理](https://gitee.com/zhangzwd/pic-bed/raw/master/blog/AQS原理.png)

这个图则清晰的说明了AQS中独占锁的的基本原理，下面LZ将用一段简单的代码来看看AQS中独占锁的工作原理。
```java
public class ExclusiveDemo implements Lock {    
    // 静态内部类，自定义同步器    
    private static class Sync extends AbstractQueuedSynchronizer{        
        // 是否处于独占状态        
        @Override        
        protected boolean isHeldExclusively() {            
            return this.getState() == 1;        
        }        
        // 当状态为0时，获取锁        
        @Override        
        protected boolean tryAcquire(int arg) {           
            if(compareAndSetState(0,1)){                
                setExclusiveOwnerThread(Thread.currentThread());                
                return true;            
            }           
            return false;      
        }        
        // 释放锁，将状态设置为0        
        @Override        
        protected boolean tryRelease(int arg) {           
            if(getState() == 0) throw new IllegalMonitorStateException();                       
            setExclusiveOwnerThread(null);            
            setState(0);            
            return true;        
        }        
        // 返回一个Condition,没给Condition都包含了一个Condition队列        
        Condition newCondition() {            
            return new ConditionObject();       
        }   
    }    
    private final Sync sync = new Sync();    
    @Override    
    public void lock() {        
        sync.acquire(1);   
    }   
    @Override    
    public void lockInterruptibly() throws InterruptedException {        
        sync.acquireInterruptibly(1);    
    }   
    @Override    
    public boolean tryLock() {        
        return sync.tryAcquire(1);    
    }    
    @Override    
    public boolean tryLock(long time, TimeUnit unit) throws InterruptedException {   
        return sync.tryAcquireSharedNanos(1,unit.toNanos(time));   
    }   
    @Override   
    public void unlock() {       
        sync.release(0);   
    }    
    @Override   
    public Condition newCondition() {      
        return sync.newCondition();    
    }
}
```
上面示例中，独占锁ExclusiveDemo是一个自定义的同步组件，它在同一时刻只允许一个线程占有锁。ExclusiveDemo定义了一个静态内部类，该内部类继承了同步器并实现了独占式获取和释放同步状态。在tryAcquire方法中，通过CAS方式设置同步器状态，如果设置成功，返回true，设置失败返回false。tryRelease(int arg)方法是将同步器状态设置为0。通过上面的示例，我么可以看到，当我们在使用ExclusiveDemo的时候，我们并没有直接和同步器打交道，而是通过调用ExclusiveDemo提供的方法。这一章LZ只是简单的介绍了下AQS是如何工作的，下一章LZ分析下AQS中CHL的工作原理。
