Feature: Car removal from race

  When a car is destroyed or otherwise unable to continue,
  the operator removes it. Completed results are preserved
  and remaining heats are regenerated without the car.

  Background:
    Given a race is in progress with a started section

  Scenario: Remove car after catastrophic failure
    Given heat 3 has just been completed
    And car #5 "Broken Betty" finished in that heat
    When the operator removes car #5 with reason "destroyed"
    Then a confirmation dialog should appear
    And after confirming, the remaining heats should not include car #5
    And car #5's prior results should still appear on the leaderboard

  Scenario: Removed car cannot be removed again
    Given car #5 has already been removed
    Then the remove car option should not be available for car #5
