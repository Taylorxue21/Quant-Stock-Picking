# 1-10 数字循环代码

# 方法1: 使用 for 循环
print("=== 方法1: for 循环 ===")
for i in range(1, 11):
    print(i, end=" ")
print()

# 方法2: 使用 while 循环
print("\n=== 方法2: while 循环 ===")
i = 1
while i <= 10:
    print(i, end=" ")
    i += 1
print()

# 方法3: 使用列表推导式
print("\n=== 方法3: 列表推导式 ===")
numbers = [i for i in range(1, 11)]
print(numbers)

# 方法4: 无限循环（按 Ctrl+C 停止）
print("\n=== 方法4: 无限循环（按 Ctrl+C 停止）===")
import time
try:
    i = 1
    while True:
        print(f"\r当前数字: {i}", end="")
        i += 1
        if i > 10:
            i = 1
        time.sleep(0.5)
except KeyboardInterrupt:
    print("\n循环已停止")
