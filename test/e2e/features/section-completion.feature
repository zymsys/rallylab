Feature: Section completion

  Verify what happens when all heats in a section are completed.
  Uses a small roster (4 participants, 3 lanes = 4 heats) for speed.

  Background:
    Given a small race is in progress with a started section

  Scenario: All heats complete shows final results
    When all remaining heats are completed
    Then I should see the heading "Kub Kars — Final Results"
    And I should see all 4 participants on the leaderboard

  Scenario: Final leaderboard has correct columns
    When all remaining heats are completed
    Then the leaderboard should have columns "Rank, Car #, Name, Avg Time, Best Time, Heats"

  Scenario: Return to rally home shows Complete status
    When all remaining heats are completed
    And I click "Return to Rally Home"
    Then I should see "Complete"
    And I should see "Results"

  Scenario: Results button reopens final results
    When all remaining heats are completed
    And I click "Return to Rally Home"
    And I click "Results"
    Then I should see the heading "Kub Kars — Final Results"
