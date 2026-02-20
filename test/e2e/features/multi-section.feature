Feature: Multi-section racing

  Verify that multiple sections can be raced in sequence.
  Uses two small sections (4 participants each, 3 lanes = 4 heats).

  Background:
    Given a rally with two sections
    And section A is started with all cars checked in

  Scenario: Completing first section shows second as Not Started
    When all remaining heats are completed
    And I click "Return to Rally Home"
    Then I should see "Complete" for section "Kub Kars"
    And I should see "Not Started" for section "Scout Trucks"

  Scenario: Both sections can be raced to completion
    When all remaining heats are completed
    And I click "Return to Rally Home"
    And I start section B from rally home
    And all remaining heats are completed
    And I click "Return to Rally Home"
    Then I should see "Complete" for section "Kub Kars"
    And I should see "Complete" for section "Scout Trucks"

  Scenario: View results for each completed section
    When all remaining heats are completed
    And I click "Return to Rally Home"
    And I start section B from rally home
    And all remaining heats are completed
    And I click "Return to Rally Home"
    And I click "Results" for "Kub Kars"
    Then I should see the heading "Kub Kars — Final Results"
