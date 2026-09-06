#include <Security/Security.h>
#include <stdio.h>

/* Read only: preserve the pre-existing lock state of the dedicated release keychain. */
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    SecKeychainRef keychain = NULL;
    SecKeychainStatus status = 0;
    OSStatus result = SecKeychainOpen(argv[1], &keychain);
    if (result == errSecSuccess) result = SecKeychainGetStatus(keychain, &status);
    if (keychain != NULL) CFRelease(keychain);
    if (result != errSecSuccess) return 1;
    puts((status & kSecUnlockStateStatus) ? "unlocked" : "locked");
    return 0;
}
