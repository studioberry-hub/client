from PIL import Image
img = Image.open('mc_skin.png')
print("Format:", img.format, "Size:", img.size, "Mode:", img.mode)
extrema = img.getextrema()
print("Extrema:", extrema)
