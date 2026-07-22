/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/*.test.ts', '**/*.test.tsx'],
    moduleNameMapper: {
        '\\.(css)$': '<rootDir>/tests/styleMock.cjs',
    },
    transform: {
        '^.+\\.(ts|tsx)$': [
            'ts-jest',
            { tsconfig: { isolatedModules: true } },
        ],
    },
};
