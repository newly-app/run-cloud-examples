package cloud.run.examples.screenshot;

final class TapTargetAlignment {
    private TapTargetAlignment() {}

    static Result calculate(int viewportHeight, int targetCenterWithoutSpacer, float normalizedY) {
        int delta = Math.round(viewportHeight * normalizedY) - targetCenterWithoutSpacer;
        return new Result(Math.max(0, delta), Math.min(0, delta));
    }

    static final class Result {
        final int spacerHeight;
        final int translationY;

        Result(int spacerHeight, int translationY) {
            this.spacerHeight = spacerHeight;
            this.translationY = translationY;
        }
    }
}
