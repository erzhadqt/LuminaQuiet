Import("env")

try:
    with open(".env", "r") as f:
        for line in f:
            line = line.strip()
            # Ignore blank lines and comments
            if line and not line.startswith("#"):
                key, value = line.split("=", 1)
                # Inject the variable as a string macro into C++
                env.Append(CPPDEFINES=[(key, f'\\"{value}\\"')])
except FileNotFoundError:
    print("Warning: No .env file found.")