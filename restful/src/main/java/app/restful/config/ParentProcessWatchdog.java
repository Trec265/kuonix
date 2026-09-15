package app.restful.config;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import jakarta.annotation.PostConstruct;

/**
 * Shuts the backend down when the Electron process that launched it exits.
 *
 * Electron kills the backend on a normal quit, but a force-killed or crashed
 * Electron main process runs no cleanup, which would leave an orphaned JVM
 * holding its port. Electron passes its PID as {@code kuonix.parent-pid};
 * without it (bootRun, tests) this does nothing.
 */
@Configuration
public class ParentProcessWatchdog {

    private static final Logger log = LoggerFactory.getLogger(ParentProcessWatchdog.class);

    private final long parentPid;

    public ParentProcessWatchdog(@Value("${kuonix.parent-pid:0}") long parentPid) {
        this.parentPid = parentPid;
    }

    @PostConstruct
    public void watchParent() {
        if (parentPid <= 0) {
            return;
        }
        Optional<ProcessHandle> parent = ProcessHandle.of(parentPid).filter(ProcessHandle::isAlive);
        if (parent.isEmpty()) {
            log.warn("Parent process {} is not running; exiting", parentPid);
            exitAsync();
            return;
        }
        log.info("Watching parent process {}", parentPid);
        parent.get().onExit().thenRun(() -> {
            log.info("Parent process {} exited; shutting down backend", parentPid);
            exitAsync();
        });
    }

    // System.exit runs Spring's shutdown hook, which closes the context. It is
    // called off the caller's thread so it never deadlocks context startup.
    private void exitAsync() {
        new Thread(() -> System.exit(0), "parent-watchdog-exit").start();
    }
}
