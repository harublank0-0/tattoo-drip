import vine from "@vinejs/vine";

/**
 * The field rule for every image upload. Only a first filter on size and
 * extension: ImageService.store() checks what the file really is.
 */
export const imageFile = () =>
	vine.file({ size: "10mb", extnames: ["jpg", "jpeg", "png", "webp"] });
