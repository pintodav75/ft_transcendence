import bcrypt from "bcryptjs";


export const hashPassword = async (plainPassword: string) => {
    const hashedPassword = await bcrypt.hash(plainPassword, 12);
    return hashedPassword;
};

export const verifyPassword = async (password: string, passwordHash: string) => {
    const match = await bcrypt.compare(password, passwordHash);
    return match;
}